import { resolve } from 'node:path'

export function databasePathFromEnvironment(environment: NodeJS.ProcessEnv): string {
  const configured = environment.SIMPROOF_DATABASE_PATH ?? 'data/metadata.sqlite'
  if (configured.length === 0 || configured.length > 4_096 || configured.includes('\0')) {
    throw new TypeError('SIMPROOF_DATABASE_PATH is invalid.')
  }
  return resolve(configured)
}

export function databasePathFromProcess(): string {
  return databasePathFromEnvironment(process.env)
}
