import { constants, type Stats } from 'node:fs'
import { type FileHandle, lstat, open, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { z } from 'zod'

import { GENERATED_ARTIFACT_PATHS, type GeneratedArtifactSet } from './types.js'

const MAX_ARTIFACT_BYTES = 262_144
const jsonObjectSchema = z.record(z.string(), z.unknown())

const manifestSchema = (domain: 'projectile' | 'pendulum') =>
  z
    .object({
      schemaVersion: z.literal('1'),
      domain: z.literal(domain),
      core: z.literal('core.mjs'),
      renderer: z.literal('renderer.json'),
      testAdapter: z.literal('test-adapter.json'),
    })
    .strict()

export interface CodexArtifactTurn {
  readonly finalResponse: string
  readonly items: readonly {
    readonly type: string
    readonly changes?: readonly { readonly path: string }[]
  }[]
}

export interface CodexArtifactReadHooks {
  readonly afterLstat?: (name: string, path: string) => Promise<void> | void
  readonly afterOpen?: (name: string, path: string) => Promise<void> | void
  readonly beforeFinalInventory?: (workspace: string) => Promise<void> | void
}

export const inventoryNames = async (workspace: string): Promise<readonly string[] | undefined> => {
  try {
    const entries = await readdir(workspace, { withFileTypes: true })
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) return undefined
    return entries.map(({ name }) => name).sort()
  } catch {
    return undefined
  }
}

export const hasExactArtifactInventory = (names: readonly string[]) =>
  names.length === GENERATED_ARTIFACT_PATHS.length &&
  GENERATED_ARTIFACT_PATHS.every((name) => names.includes(name))

const parseJsonObject = (content: string) => {
  try {
    return jsonObjectSchema.safeParse(JSON.parse(content))
  } catch {
    return undefined
  }
}

const validArtifactMetadata = (metadata: Stats) =>
  metadata.isFile() &&
  !metadata.isSymbolicLink() &&
  metadata.nlink === 1 &&
  metadata.size >= 1 &&
  metadata.size <= MAX_ARTIFACT_BYTES

const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino

const stillSameArtifact = async (path: string, initial: OpenedArtifact | undefined) => {
  if (initial === undefined) return false
  try {
    const current = await lstat(path)
    return validArtifactMetadata(current) && sameFile(initial.metadata, current)
  } catch {
    return false
  }
}

const readBounded = async (handle: FileHandle): Promise<string | undefined> => {
  const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return offset > MAX_ARTIFACT_BYTES ? undefined : buffer.subarray(0, offset).toString('utf8')
}

interface OpenedArtifact {
  readonly content: string
  readonly metadata: Stats
}

const readOpenedArtifact = async (
  path: string,
  name: string,
  hooks: CodexArtifactReadHooks,
): Promise<OpenedArtifact | undefined> => {
  try {
    const pathMetadata = await lstat(path)
    if (!validArtifactMetadata(pathMetadata)) return undefined
    await hooks.afterLstat?.(name, path)
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const handle = await open(path, constants.O_RDONLY | noFollow)
    try {
      const metadata = await handle.stat()
      if (!validArtifactMetadata(metadata) || !sameFile(pathMetadata, metadata)) return undefined
      await hooks.afterOpen?.(name, path)
      const content = await readBounded(handle)
      return content === undefined ? undefined : { content, metadata }
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

const validJsonArtifacts = (
  renderer: string,
  manifest: string,
  testAdapter: string,
  domain: 'projectile' | 'pendulum',
) =>
  parseJsonObject(renderer)?.success === true &&
  parseJsonObject(testAdapter)?.success === true &&
  manifestSchema(domain).safeParse(parseJsonObject(manifest)?.data).success === true

const openExactInventory = async (
  workspace: string,
  hooks: CodexArtifactReadHooks,
): Promise<ReadonlyMap<string, OpenedArtifact> | undefined> => {
  const names = await inventoryNames(workspace)
  if (names === undefined || !hasExactArtifactInventory(names)) return undefined
  const opened = new Map<string, OpenedArtifact>()
  for (const name of GENERATED_ARTIFACT_PATHS) {
    const artifact = await readOpenedArtifact(join(workspace, name), name, hooks)
    if (artifact === undefined) return undefined
    opened.set(name, artifact)
  }
  return opened
}

const finalInventoryMatches = async (
  workspace: string,
  opened: ReadonlyMap<string, OpenedArtifact>,
  hooks: CodexArtifactReadHooks,
) => {
  try {
    await hooks.beforeFinalInventory?.(workspace)
  } catch {
    return false
  }
  const names = await inventoryNames(workspace)
  if (names === undefined || !hasExactArtifactInventory(names)) return false
  const identities = await Promise.all(
    GENERATED_ARTIFACT_PATHS.map(
      async (name) => await stillSameArtifact(join(workspace, name), opened.get(name)),
    ),
  )
  return identities.every(Boolean)
}

const artifactSetFrom = (
  opened: ReadonlyMap<string, OpenedArtifact>,
  domain: 'projectile' | 'pendulum',
): GeneratedArtifactSet | undefined => {
  const core = opened.get('core.mjs')?.content ?? ''
  const renderer = opened.get('renderer.json')?.content ?? ''
  const manifest = opened.get('manifest.json')?.content ?? ''
  const testAdapter = opened.get('test-adapter.json')?.content ?? ''
  if (!validJsonArtifacts(renderer, manifest, testAdapter, domain)) return undefined
  return {
    core: { path: 'core.mjs', content: core },
    renderer: { path: 'renderer.json', content: renderer },
    manifest: { path: 'manifest.json', content: manifest },
    testAdapter: { path: 'test-adapter.json', content: testAdapter },
  }
}

const readArtifacts = async (
  workspace: string,
  domain: 'projectile' | 'pendulum',
  hooks: CodexArtifactReadHooks,
): Promise<GeneratedArtifactSet | undefined> => {
  const opened = await openExactInventory(workspace, hooks)
  if (opened === undefined || !(await finalInventoryMatches(workspace, opened, hooks))) {
    return undefined
  }
  return artifactSetFrom(opened, domain)
}

const pathAllowed = (workspace: string, candidate: string) => {
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(workspace, candidate)
  const offset = relative(workspace, absolute)
  return (
    !offset.startsWith('..') &&
    !isAbsolute(offset) &&
    GENERATED_ARTIFACT_PATHS.some((path) => path === offset)
  )
}

const reportedChangesAllowed = (workspace: string, turn: CodexArtifactTurn) =>
  turn.items.every(
    (item) =>
      item.type !== 'file_change' ||
      (item.changes ?? []).every(({ path }) => pathAllowed(workspace, path)),
  )

const seedArtifacts = async (workspace: string, artifacts: GeneratedArtifactSet) => {
  const ordered = [
    artifacts.core,
    artifacts.renderer,
    artifacts.manifest,
    artifacts.testAdapter,
  ] as const
  for (const artifact of ordered) {
    if (Buffer.byteLength(artifact.content, 'utf8') > MAX_ARTIFACT_BYTES) {
      return false
    }
    await writeFile(join(workspace, artifact.path), artifact.content, { flag: 'wx', mode: 0o600 })
  }
  return true
}

export const prepareArtifactWorkspace = async (
  workspace: string,
  previousArtifacts: GeneratedArtifactSet | undefined,
) => {
  try {
    const seeded =
      previousArtifacts === undefined || (await seedArtifacts(workspace, previousArtifacts))
    const names = await inventoryNames(workspace)
    return (
      seeded &&
      names !== undefined &&
      (previousArtifacts === undefined ? names.length === 0 : hasExactArtifactInventory(names))
    )
  } catch {
    return false
  }
}

export const validatedTurnArtifacts = async (
  workspace: string,
  turn: CodexArtifactTurn,
  domain: 'projectile' | 'pendulum',
  hooks: CodexArtifactReadHooks = {},
): Promise<GeneratedArtifactSet | undefined> => {
  // The model's self-reported completion message is not trusted. The
  // authoritative signal is the exact set of files it actually wrote to the
  // workspace, which readArtifacts validates: exact inventory, no symlinks,
  // size bounds, JSON validity, and manifest schema. reportedChangesAllowed
  // keeps a reported write from pointing outside the artifact allowlist.
  //
  // Forcing the turn into a structured-output object (an outputSchema) made the
  // model emit the completion JSON in place of doing the work, so it left the
  // workspace empty while burning tokens; trusting the on-disk artifacts is
  // both correct and what actually lets generation succeed.
  if (!reportedChangesAllowed(workspace, turn)) return undefined
  return await readArtifacts(workspace, domain, hooks)
}
