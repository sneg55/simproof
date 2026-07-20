import { AsyncLocalStorage } from 'node:async_hooks'

const locks = new Map<string, Promise<void>>()
const active = new Set<string>()
const ownership = new AsyncLocalStorage<string>()

export function maintenanceActive(key: string): boolean {
  return active.has(key)
}

export function writeAllowed(key: string): boolean {
  return !active.has(key) || ownership.getStore() === key
}

export async function withMaintenanceLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return await withKeyLock(key, true, operation)
}

export async function withOperationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return await withKeyLock(key, true, operation)
}

async function withKeyLock<T>(
  key: string,
  maintenance: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  locks.set(key, queued)
  await previous
  if (maintenance) active.add(key)
  try {
    return await ownership.run(key, operation)
  } finally {
    release?.()
    if (maintenance) active.delete(key)
    if (locks.get(key) === queued) locks.delete(key)
  }
}
