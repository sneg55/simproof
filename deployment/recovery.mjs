import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename as renamePath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { importRuntimePackage } from './runtime-import.mjs'

export async function activateRestore(input, hooks = {}) {
  const rename = hooks.rename ?? renamePath
  const validate = hooks.validate ?? validateRestoreCandidate
  const release = await acquireExclusiveLease(input.root)
  const restores = join(input.root, 'restores')
  const rollbacks = join(input.root, 'rollbacks')
  const current = join(input.root, 'current')
  const candidate = join(restores, input.name)
  const rollback = join(rollbacks, input.rollback)
  let priorMoved = false
  let published = false
  try {
    await assertDirectory(current, 'Current data root is invalid.')
    await assertDirectory(candidate, 'Restore candidate is invalid.')
    if (await exists(rollback)) throw new Error('Rollback destination already exists.')
    await validate(candidate)
    await rename(current, rollback)
    priorMoved = true
    await syncParents([input.root, rollbacks], hooks.syncDirectory)
    await rename(candidate, current)
    published = true
    await syncParents([input.root, restores], hooks.syncDirectory)
  } catch (error) {
    if (!priorMoved) throw error
    await recoverSwap({
      current,
      prior: rollback,
      published: published ? candidate : undefined,
      parents: [input.root, restores, rollbacks],
      rename,
      syncDirectory: hooks.syncDirectory,
    }).catch(() => undefined)
    throw new Error('Restore activation failed.')
  } finally {
    await release()
  }
}

export async function withExclusiveLease(root, operation) {
  const release = await acquireExclusiveLease(root)
  try {
    return await operation()
  } finally {
    await release()
  }
}

export async function rollbackRestore(input, hooks = {}) {
  const rename = hooks.rename ?? renamePath
  const validate = hooks.validate ?? validateRestoreCandidate
  const release = await acquireExclusiveLease(input.root)
  const rollbacks = join(input.root, 'rollbacks')
  const current = join(input.root, 'current')
  const knownGood = join(rollbacks, input.name)
  const failed = join(rollbacks, input.failed)
  let priorMoved = false
  let published = false
  try {
    await assertDirectory(current, 'Current data root is invalid.')
    await assertDirectory(knownGood, 'Rollback source is invalid.')
    if (await exists(failed)) throw new Error('Failed-root destination already exists.')
    await validate(knownGood)
    await rename(current, failed)
    priorMoved = true
    await syncParents([input.root, rollbacks], hooks.syncDirectory)
    await rename(knownGood, current)
    published = true
    await syncParents([input.root, rollbacks], hooks.syncDirectory)
  } catch (error) {
    if (!priorMoved) throw error
    await recoverSwap({
      current,
      prior: failed,
      published: published ? knownGood : undefined,
      parents: [input.root, rollbacks],
      rename,
      syncDirectory: hooks.syncDirectory,
    }).catch(() => undefined)
    throw new Error('Rollback activation failed.')
  } finally {
    await release()
  }
}

export async function validateRestoreCandidate(candidate) {
  const persistence = await importRuntimePackage('@simproof/persistence')
  const databasePath = join(candidate, 'metadata.sqlite')
  const artifactRoot = join(candidate, 'artifacts')
  await assertCandidatePaths(candidate, databasePath, artifactRoot)
  const artifacts = new persistence.ArtifactStore(artifactRoot)
  const inspected = persistence.inspectPersistence(databasePath)
  if (!inspected.ok) throw new Error('Restore candidate is invalid.')
  const database = persistence.createPersistence(databasePath)
  try {
    if (!database.readiness().ok || !database.integrityCheck().ok) {
      throw new Error('Restore candidate is invalid.')
    }
    const identities = await artifacts.identities()
    const formats = database.records.storedArtifactFormats()
    if (
      !identities.ok ||
      !formats.ok ||
      !sameIdentities(
        identities.value,
        formats.value.map(({ hash }) => hash),
      ) ||
      !(await database.validateStoredRecords(artifacts)).ok
    ) {
      throw new Error('Restore candidate is invalid.')
    }
  } finally {
    database.close()
  }
  const readOnly = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = readOnly.prepare('SELECT COUNT(*) AS count FROM administrator_sessions').get()
    if (Number(row?.count) !== 0) throw new Error('Restore candidate is invalid.')
  } finally {
    readOnly.close()
  }
}

async function assertCandidatePaths(candidate, databasePath, artifactRoot) {
  const expected = resolve(candidate)
  const entries = await readdir(expected).catch(() => undefined)
  const candidateMetadata = await lstat(expected).catch(() => undefined)
  const databaseMetadata = await lstat(databasePath).catch(() => undefined)
  const artifactMetadata = await lstat(artifactRoot).catch(() => undefined)
  if (
    candidateMetadata === undefined ||
    !candidateMetadata.isDirectory() ||
    candidateMetadata.isSymbolicLink() ||
    entries === undefined ||
    entries.length !== 2 ||
    !entries.includes('metadata.sqlite') ||
    !entries.includes('artifacts') ||
    databaseMetadata === undefined ||
    !databaseMetadata.isFile() ||
    databaseMetadata.isSymbolicLink() ||
    artifactMetadata === undefined ||
    !artifactMetadata.isDirectory() ||
    artifactMetadata.isSymbolicLink()
  ) {
    throw new Error('Restore candidate is invalid.')
  }
  const canonical = await realpath(expected)
  if (
    dirname(await realpath(databasePath)) !== canonical ||
    dirname(await realpath(artifactRoot)) !== canonical
  ) {
    throw new Error('Restore candidate is invalid.')
  }
}

function sameIdentities(left, right) {
  const expected = [...right].sort()
  return (
    left.length === expected.length &&
    [...left].sort().every((value, index) => value === expected[index])
  )
}

async function acquireExclusiveLease(root) {
  const marker = join(root, '.application-running')
  let created = false
  try {
    await mkdir(marker)
    created = true
    await syncDirectory(root)
  } catch {
    if (created) {
      await rm(marker, { recursive: true, force: true }).catch(() => undefined)
      await syncDirectory(root).catch(() => undefined)
    }
    throw new Error('Maintenance refused because the application is not stopped.')
  }
  return async () => {
    await rm(marker, { recursive: true, force: true })
    await syncDirectory(root)
  }
}

async function assertDirectory(path, message) {
  const metadata = await lstat(path).catch(() => undefined)
  if (metadata === undefined || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(message)
  }
}

async function exists(path) {
  return await lstat(path).then(
    () => true,
    (error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    },
  )
}

async function syncParents(paths, sync = syncDirectory) {
  let failure
  for (const path of [...new Set(paths)]) {
    try {
      await sync(path)
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}

async function recoverSwap(input) {
  if (input.published !== undefined) await input.rename(input.current, input.published)
  await input.rename(input.prior, input.current)
  await syncParents(input.parents, input.syncDirectory)
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
