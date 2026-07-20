import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REVISION_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u

export function releaseSourceIdentity(root) {
  const revision = git(root, ['rev-parse', '--verify', 'HEAD'])
  if (!REVISION_PATTERN.test(revision)) throw new Error('Current Git source revision is invalid.')
  const epochSource = git(root, ['show', '-s', '--format=%ct', 'HEAD'])
  if (!/^\d{1,12}$/u.test(epochSource)) throw new Error('Current Git source epoch is invalid.')
  return { revision, sourceDateEpoch: Number(epochSource) }
}

export function assertCleanReleaseSource(root, expectedRevision, expectedSourceDateEpoch) {
  const { revision, sourceDateEpoch } = releaseSourceIdentity(root)
  if (revision !== expectedRevision)
    throw new Error('Requested source revision is not the current Git HEAD.')
  if (sourceDateEpoch !== Number(expectedSourceDateEpoch)) {
    throw new Error('Requested source date epoch is not the current Git commit epoch.')
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') throw new Error('Release evidence requires a clean index and worktree.')
  return { revision, sourceDateEpoch }
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: resolve(root),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  try {
    if (
      process.argv.length !== 6 ||
      process.argv[2] !== '--source-revision' ||
      process.argv[4] !== '--source-date-epoch'
    ) {
      throw new TypeError(
        'Usage: node scripts/release-source.mjs --source-revision SHA --source-date-epoch EPOCH',
      )
    }
    assertCleanReleaseSource(process.cwd(), process.argv[3], process.argv[5])
    process.stdout.write('Release source is identified and clean.\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
