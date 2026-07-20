import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative, resolve, sep } from 'node:path'

export const normalizeFingerprintBytes = (path: string, contents: Buffer): Buffer => {
  if (path.startsWith('tests/fixtures/')) return contents
  const extension = path.split('.').at(-1)
  if (!['json', 'md', 'mjs', 'ts', 'tsx'].includes(extension ?? '')) return contents
  const source = contents.toString('utf8')
  const withoutBom = source.startsWith('\uFEFF') ? source.slice(1) : source
  return Buffer.from(withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8')
}

export const inventoryFor = (repositoryRoot: string, packId: string): readonly string[] => {
  const source = readFileSync(
    resolve(repositoryRoot, `packages/verifier/src/domains/${packId}/inventory.json`),
    'utf8',
  )
  const parsed = JSON.parse(source) as { readonly paths?: unknown }
  if (!Array.isArray(parsed.paths)) {
    throw new TypeError(`The ${packId} inventory is invalid.`)
  }
  const paths: string[] = []
  for (const path of parsed.paths) {
    if (typeof path !== 'string') throw new TypeError(`The ${packId} inventory is invalid.`)
    paths.push(path)
  }
  return paths
}

const pathIsCanonical = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  posix.normalize(path) === path &&
  path !== '..' &&
  !path.startsWith('../')

const hasSymbolicLinkSegment = (repositoryRoot: string, absolute: string): boolean => {
  const repositoryRelative = relative(repositoryRoot, absolute)
  if (repositoryRelative === '' || repositoryRelative.startsWith(`..${sep}`)) return false
  let current = repositoryRoot
  for (const segment of repositoryRelative.split(sep)) {
    current = join(current, segment)
    if (lstatSync(current).isSymbolicLink()) return true
  }
  return false
}

export const inspectCandidate = (
  repositoryRoot: string,
  paths: readonly string[],
  expected: readonly string[],
) => {
  const canonical =
    paths.length > 0 &&
    new Set(paths).size === paths.length &&
    paths.every(pathIsCanonical) &&
    paths.every((path, index) => index === 0 || paths[index - 1]!.localeCompare(path) < 0)
  const complete = JSON.stringify(paths) === JSON.stringify(expected)
  let inRoot = true
  let regularFiles = true
  for (const path of paths) {
    try {
      const absolute = resolve(repositoryRoot, path)
      const canonicalPath = realpathSync(absolute)
      inRoot &&=
        canonicalPath === repositoryRoot || canonicalPath.startsWith(`${repositoryRoot}${sep}`)
      const metadata = lstatSync(absolute)
      regularFiles &&=
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        !hasSymbolicLinkSegment(repositoryRoot, absolute)
    } catch {
      inRoot = false
      regularFiles = false
    }
  }
  return { canonical, complete, inRoot, regularFiles }
}

export const inventoryAttackMatrix = () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'simproof-pack-attacks-'))
  try {
    mkdirSync(resolve(fixtureRoot, 'actual'))
    mkdirSync(resolve(fixtureRoot, 'directory'))
    writeFileSync(resolve(fixtureRoot, 'regular.ts'), 'export const regular = true\n', 'utf8')
    writeFileSync(resolve(fixtureRoot, 'actual/intermediate.ts'), 'export const linked = true\n')
    symlinkSync('regular.ts', resolve(fixtureRoot, 'final-link.ts'))
    symlinkSync('actual', resolve(fixtureRoot, 'intermediate-link'))

    const completeInspection = (path: string) => inspectCandidate(fixtureRoot, [path], [path])
    return {
      traversal: completeInspection('../outside.ts'),
      absolute: completeInspection(resolve(fixtureRoot, 'regular.ts')),
      finalSymlink: completeInspection('final-link.ts'),
      intermediateSymlink: completeInspection('intermediate-link/intermediate.ts'),
      directory: completeInspection('directory'),
      device: completeInspection('/dev/null'),
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

export const attacksAreRejected = (): boolean => {
  const attacks = inventoryAttackMatrix()
  return (
    attacks.traversal.complete &&
    !attacks.traversal.canonical &&
    attacks.absolute.complete &&
    !attacks.absolute.canonical &&
    attacks.finalSymlink.complete &&
    !attacks.finalSymlink.regularFiles &&
    attacks.intermediateSymlink.complete &&
    !attacks.intermediateSymlink.regularFiles &&
    attacks.directory.complete &&
    !attacks.directory.regularFiles &&
    attacks.device.complete &&
    !attacks.device.regularFiles
  )
}

export const contentHash = (repositoryRoot: string, paths: readonly string[]): string => {
  const hash = createHash('sha256')
  hash.update('simproof-domain-pack-v2\0', 'utf8')
  for (const path of paths) {
    const contents = normalizeFingerprintBytes(path, readFileSync(resolve(repositoryRoot, path)))
    hash.update(`${path}\0${contents.byteLength}\0`, 'utf8')
    hash.update(contents)
    hash.update('\0', 'utf8')
  }
  return `sha256:${hash.digest('hex')}`
}
