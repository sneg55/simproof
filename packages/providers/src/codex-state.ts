import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export interface CodexStateLease {
  readonly path: string
  adopt(threadId: string): Promise<boolean>
  discard(): Promise<boolean>
}

export type CodexStateResult =
  | { readonly ok: true; readonly value: CodexStateLease }
  | { readonly ok: false }

export interface CodexStateStore {
  begin(): Promise<CodexStateResult>
  resume(threadId: string): Promise<CodexStateResult>
  disposeThread(threadId: string): Promise<boolean>
  listOwnedState(): Promise<readonly CodexOwnedState[] | undefined>
  disposeOrphanedState(retainedThreadIds?: readonly string[]): Promise<boolean>
}

export interface CodexOwnedState {
  readonly kind: 'pending' | 'thread'
  readonly name: string
}

const realDirectory = async (path: string): Promise<string | undefined> => {
  if (!isAbsolute(path)) return undefined
  try {
    const canonical = await realpath(path)
    const metadata = await lstat(canonical)
    return metadata.isDirectory() && resolve(path) === canonical ? canonical : undefined
  } catch {
    return undefined
  }
}

const isWithin = (candidate: string, parent: string) => {
  const offset = relative(parent, candidate)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

const existingRealPaths = async (paths: readonly string[]) =>
  (
    await Promise.all(
      paths.map(async (path) => {
        try {
          return await realpath(path)
        } catch {
          return undefined
        }
      }),
    )
  ).filter((path): path is string => path !== undefined)

const remove = async (path: string) => {
  try {
    await rm(path, { force: true, recursive: true })
    return true
  } catch {
    return false
  }
}

const threadDirectory = (root: string, threadId: string) => {
  const digest = createHash('sha256').update(threadId, 'utf8').digest('hex')
  return join(root, `thread-${digest}`)
}

const pendingName = /^pending-[A-Za-z0-9]{6}$/u
const threadName = /^thread-[0-9a-f]{64}$/u

const ownedKind = (name: string): CodexOwnedState['kind'] | undefined => {
  if (pendingName.test(name)) return 'pending'
  return threadName.test(name) ? 'thread' : undefined
}

const safeOwnedDirectory = async (root: string, name: string) => {
  const kind = ownedKind(name)
  if (kind === undefined) return undefined
  const path = join(root, name)
  const canonical = await realDirectory(path)
  return canonical !== undefined && dirname(canonical) === root
    ? { kind, name, path: canonical }
    : undefined
}

export class FilesystemCodexStateStore implements CodexStateStore {
  readonly #root: string
  readonly #forbiddenRoots: readonly string[]

  constructor(root: string, forbiddenRoots: readonly string[] = [process.cwd()]) {
    this.#root = root
    this.#forbiddenRoots = forbiddenRoots
  }

  async begin(): Promise<CodexStateResult> {
    const root = await this.#validatedRoot()
    if (root === undefined) return { ok: false }
    let pending: string | undefined
    try {
      pending = await mkdtemp(join(root, 'pending-'))
      const canonical = await realpath(pending)
      if (dirname(canonical) !== root) {
        await remove(pending)
        return { ok: false }
      }
      let currentPath = canonical
      return {
        ok: true,
        value: {
          path: canonical,
          adopt: async (threadId) => {
            const target = threadDirectory(root, threadId)
            if (dirname(target) !== root) return false
            try {
              await rename(currentPath, target)
              currentPath = target
              return true
            } catch {
              return false
            }
          },
          discard: async () => await remove(currentPath),
        },
      }
    } catch {
      if (pending !== undefined) await remove(pending)
      return { ok: false }
    }
  }

  async resume(threadId: string): Promise<CodexStateResult> {
    const root = await this.#validatedRoot()
    if (root === undefined) return { ok: false }
    const path = threadDirectory(root, threadId)
    const canonical = await realDirectory(path)
    if (canonical === undefined || dirname(canonical) !== root) return { ok: false }
    return {
      ok: true,
      value: {
        path: canonical,
        adopt: (candidate) => Promise.resolve(candidate === threadId),
        discard: async () => await remove(canonical),
      },
    }
  }

  async disposeThread(threadId: string): Promise<boolean> {
    const root = await this.#validatedRoot()
    if (root === undefined) return false
    const path = threadDirectory(root, threadId)
    return dirname(path) === root && (await remove(path))
  }

  async listOwnedState(): Promise<readonly CodexOwnedState[] | undefined> {
    const root = await this.#validatedRoot()
    if (root === undefined) return undefined
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const owned = await Promise.all(
        entries.map(async ({ name }) => await safeOwnedDirectory(root, name)),
      )
      return owned
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .map(({ kind, name }) => ({ kind, name }))
        .sort((left, right) => left.name.localeCompare(right.name))
    } catch {
      return undefined
    }
  }

  async disposeOrphanedState(retainedThreadIds: readonly string[] = []): Promise<boolean> {
    const root = await this.#validatedRoot()
    if (root === undefined) return false
    const retained = new Set(retainedThreadIds.map((threadId) => threadDirectory(root, threadId)))
    const owned = await this.listOwnedState()
    if (owned === undefined) return false
    const orphaned = owned.filter(
      ({ kind, name }) => kind === 'pending' || !retained.has(join(root, name)),
    )
    const removed = await Promise.all(
      orphaned.map(async ({ name }) => {
        const entry = await safeOwnedDirectory(root, name)
        return entry !== undefined && (await remove(entry.path))
      }),
    )
    return removed.every(Boolean)
  }

  async #validatedRoot(): Promise<string | undefined> {
    const root = await realDirectory(this.#root)
    if (root === undefined || root === dirname(root)) return undefined
    const forbidden = await existingRealPaths(this.#forbiddenRoots)
    return forbidden.some((path) => isWithin(root, path) || isWithin(path, root)) ? undefined : root
  }
}
