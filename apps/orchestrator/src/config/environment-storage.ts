import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { ParsedEnvironment } from './environment-schema.js'

export interface StoragePathConfiguration {
  readonly databasePath: string
  readonly artifactRoot: string
  readonly diagnosticLogRoot: string
}

export type StorageConfigurationField =
  | 'SIMPROOF_DATABASE_PATH'
  | 'SIMPROOF_ARTIFACT_ROOT'
  | 'SIMPROOF_DIAGNOSTIC_LOG_ROOT'

export function invalidStorageConfigurationFields(
  storage: StoragePathConfiguration,
): readonly StorageConfigurationField[] {
  const invalidFields: StorageConfigurationField[] = []
  if (!isAbsolute(storage.databasePath)) invalidFields.push('SIMPROOF_DATABASE_PATH')
  if (
    !isAbsolute(storage.artifactRoot) ||
    storagePathsOverlap(storage.databasePath, storage.artifactRoot)
  ) {
    invalidFields.push('SIMPROOF_ARTIFACT_ROOT')
  }
  if (
    !isAbsolute(storage.diagnosticLogRoot) ||
    storagePathsOverlap(storage.diagnosticLogRoot, storage.databasePath) ||
    storagePathsOverlap(storage.diagnosticLogRoot, storage.artifactRoot)
  ) {
    invalidFields.push('SIMPROOF_DIAGNOSTIC_LOG_ROOT')
  }
  return invalidFields
}

export function validateStorage(value: ParsedEnvironment): {
  databasePath: string
  artifactRoot: string
  diagnosticLogRoot: string
  invalidFields: readonly string[]
} {
  const databaseInput = value.SIMPROOF_DATABASE_PATH ?? resolve('.simproof/metadata.sqlite')
  const artifactInput = value.SIMPROOF_ARTIFACT_ROOT ?? resolve('.simproof/artifacts')
  const databasePath = resolve(databaseInput)
  const artifactRoot = resolve(artifactInput)
  const diagnosticInput =
    value.SIMPROOF_DIAGNOSTIC_LOG_ROOT ?? join(dirname(databasePath), 'diagnostics')
  const diagnosticLogRoot = resolve(diagnosticInput)
  const invalidFields = invalidStorageConfigurationFields({
    databasePath: databaseInput,
    artifactRoot: artifactInput,
    diagnosticLogRoot: diagnosticInput,
  })
  return { databasePath, artifactRoot, diagnosticLogRoot, invalidFields }
}

function storagePathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return pathContains(resolvedLeft, resolvedRight) || pathContains(resolvedRight, resolvedLeft)
}

function pathContains(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  )
}
