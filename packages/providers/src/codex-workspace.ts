import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export interface CodexWorkspaceLease {
  readonly path: string
  readonly temporaryPath: string
  dispose(): Promise<boolean>
}

export type CodexWorkspaceResult =
  | { readonly ok: true; readonly value: CodexWorkspaceLease }
  | { readonly ok: false }

export interface CodexWorkspaceFactory {
  create(): Promise<CodexWorkspaceResult>
}

export const disposeCodexWorkspace = async (lease: CodexWorkspaceLease) => {
  try {
    return await lease.dispose()
  } catch {
    return false
  }
}

const isWithin = (candidate: string, parent: string) => {
  const offset = relative(parent, candidate)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
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

const existingRealPath = async (path: string): Promise<string | undefined> => {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}

const removeCreated = async (paths: readonly string[]) => {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await rm(path, { force: true, recursive: true })
      } catch {
        // The caller receives a failed workspace result; cleanup was attempted for every path.
      }
    }),
  )
}

export class FilesystemCodexWorkspaceFactory implements CodexWorkspaceFactory {
  readonly #root: string
  readonly #forbiddenRoots: readonly string[]

  constructor(root: string, forbiddenRoots: readonly string[] = [process.cwd()]) {
    this.#root = root
    this.#forbiddenRoots = forbiddenRoots
  }

  async create(): Promise<CodexWorkspaceResult> {
    const root = await realDirectory(this.#root)
    if (root === undefined || root === dirname(root)) return { ok: false }
    const forbidden = (await Promise.all(this.#forbiddenRoots.map(existingRealPath))).filter(
      (path): path is string => path !== undefined,
    )
    if (forbidden.some((path) => isWithin(root, path) || isWithin(path, root))) {
      return { ok: false }
    }

    const created: string[] = []
    try {
      const path = await mkdtemp(join(root, 'artifact-'))
      created.push(path)
      const temporaryPath = await mkdtemp(join(root, 'temp-'))
      created.push(temporaryPath)
      const canonicalPath = await realpath(path)
      const canonicalTemporaryPath = await realpath(temporaryPath)
      if (dirname(canonicalPath) !== root || dirname(canonicalTemporaryPath) !== root) {
        await removeCreated(created)
        return { ok: false }
      }
      return {
        ok: true,
        value: {
          path: canonicalPath,
          temporaryPath: canonicalTemporaryPath,
          dispose: async () => {
            if (dirname(canonicalPath) !== root || dirname(canonicalTemporaryPath) !== root) {
              return false
            }
            try {
              await Promise.all([
                rm(canonicalPath, { force: true, recursive: true }),
                rm(canonicalTemporaryPath, { force: true, recursive: true }),
              ])
              return true
            } catch {
              return false
            }
          },
        },
      }
    } catch {
      await removeCreated(created)
      return { ok: false }
    }
  }
}
