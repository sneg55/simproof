import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { err, ok, type Result } from './types.js'

export async function validateOperationPath(
  operationRoot: string | undefined,
  target: string,
): Promise<Result<true>> {
  if (operationRoot === undefined) return ok(true)
  try {
    const root = resolve(operationRoot)
    const metadata = await lstat(root)
    const relativeTarget = relative(root, resolve(target))
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      relativeTarget.length === 0 ||
      relativeTarget === '..' ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      return err('invalid-input', 'Persistence operation path is outside its configured root.')
    }
    const segments = relativeTarget.split(sep)
    let current = root
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      const component = await lstat(current).catch((error: unknown) => {
        if (isMissing(error)) return undefined
        throw error
      })
      if (component === undefined) break
      if (component.isSymbolicLink() || (index < segments.length - 1 && !component.isDirectory())) {
        return err('invalid-input', 'Persistence operation path contains an unsafe component.')
      }
    }
    return ok(true)
  } catch {
    return err('invalid-input', 'Persistence operation root is invalid.')
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
