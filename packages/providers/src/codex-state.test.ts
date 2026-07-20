import { access, mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FilesystemCodexStateStore } from './codex-state.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  )
})

async function directory(prefix: string) {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(path)
  return path
}

async function adopt(store: FilesystemCodexStateStore, threadId: string) {
  const state = await store.begin()
  expect(state.ok).toBe(true)
  if (!state.ok) throw new TypeError('Expected a state lease.')
  expect(await state.value.adopt(threadId)).toBe(true)
}

describe('filesystem Codex state cleanup', () => {
  it('enumerates owned state and removes only orphaned safe directories', async () => {
    const root = await directory('simproof-state-root-')
    const outside = await directory('simproof-state-outside-')
    const store = new FilesystemCodexStateStore(root)
    await adopt(store, 'retained-thread')
    await adopt(store, 'orphaned-thread')
    const pending = await store.begin()
    expect(pending.ok).toBe(true)
    await mkdir(join(root, 'unowned-directory'))
    const disguisedLink = `thread-${'a'.repeat(64)}`
    await symlink(outside, join(root, disguisedLink))

    const owned = await store.listOwnedState()
    expect(owned?.map(({ kind }) => kind).sort()).toEqual(['pending', 'thread', 'thread'])
    expect(await store.disposeOrphanedState(['retained-thread'])).toBe(true)

    expect(await readdir(root)).toEqual(
      expect.arrayContaining(['unowned-directory', disguisedLink]),
    )
    expect((await store.listOwnedState())?.map(({ kind }) => kind)).toEqual(['thread'])
    expect(await store.resume('retained-thread')).toMatchObject({ ok: true })
    expect(await store.resume('orphaned-thread')).toEqual({ ok: false })
    await expect(access(outside)).resolves.toBeUndefined()
  })

  it('rejects a state root that contains a protected runtime root', async () => {
    const root = await directory('simproof-state-root-')
    const protectedRoot = join(root, 'application-data')
    await mkdir(protectedRoot)
    const store = new FilesystemCodexStateStore(root, [protectedRoot])

    await expect(store.begin()).resolves.toEqual({ ok: false })
    await expect(store.listOwnedState()).resolves.toBeUndefined()
  })

  it('rejects a state root nested beneath a protected runtime root', async () => {
    const protectedRoot = await directory('simproof-state-protected-')
    const root = join(protectedRoot, 'state')
    await mkdir(root)
    const store = new FilesystemCodexStateStore(root, [protectedRoot])

    await expect(store.begin()).resolves.toEqual({ ok: false })
    await expect(store.listOwnedState()).resolves.toBeUndefined()
  })
})
