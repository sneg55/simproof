import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { generateReleaseEvidence } from './release-evidence.mjs'
import { verifyReleaseEvidence } from './release-evidence-verifier.mjs'
import { assertCleanReleaseSource } from './release-source.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function runReleaseEvidenceCli(args, options = {}) {
  const repositoryRoot = resolve(options.root ?? root)
  const parsed = parseArguments(args)
  if (parsed.verify !== undefined) {
    return verifyReleaseEvidence({ root: repositoryRoot, outputDirectory: parsed.verify })
  }
  assertCleanReleaseSource(repositoryRoot, parsed.sourceRevision, parsed.sourceDateEpoch)
  return generateReleaseEvidence({ root: repositoryRoot, ...parsed })
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  try {
    const parsed = parseArguments(process.argv.slice(2))
    const manifest = await runReleaseEvidenceCli(process.argv.slice(2))
    process.stdout.write(
      parsed.verify === undefined
        ? `Generated unsigned local release evidence for ${manifest.sourceRevision}. Nothing was published.\n`
        : `Verified local release evidence for ${manifest.sourceRevision}.\n`,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function parseArguments(args) {
  if (args[0] === '--verify' && args.length === 2) return { verify: resolve(args[1]) }
  const values = {}
  const images = []
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (value === undefined || !flag?.startsWith('--')) throw new TypeError(usage())
    if (flag === '--image') {
      const separator = value.lastIndexOf('=')
      if (separator < 1) throw new TypeError('Image input must be REFERENCE=sha256:DIGEST.')
      images.push({ reference: value.slice(0, separator), digest: value.slice(separator + 1) })
    } else {
      if (Object.hasOwn(values, flag)) throw new TypeError(`Duplicate option: ${flag}`)
      values[flag] = value
    }
  }
  const allowed = new Set([
    '--output',
    '--release-version',
    '--source-revision',
    '--source-date-epoch',
  ])
  if (
    Object.keys(values).some((flag) => !allowed.has(flag)) ||
    Object.keys(values).length !== allowed.size ||
    images.length === 0
  ) {
    throw new TypeError(usage())
  }
  return {
    outputDirectory: resolve(values['--output']),
    releaseVersion: values['--release-version'],
    sourceRevision: values['--source-revision'],
    sourceDateEpoch: values['--source-date-epoch'],
    images,
  }
}

function usage() {
  return (
    'Usage: node scripts/generate-release-evidence.mjs ' +
    '--output DIR --release-version VERSION --source-revision SHA --source-date-epoch EPOCH ' +
    '--image REFERENCE=sha256:DIGEST [--image ...]\n' +
    '   or: node scripts/generate-release-evidence.mjs --verify DIR'
  )
}
