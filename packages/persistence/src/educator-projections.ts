import type { DatabaseSync } from 'node:sqlite'

import type { BundledExampleMetadata, EducatorLibraryItem } from './educator-types.js'

export interface LibraryRow {
  id: string
  title: string
  updated_at: string
  version_id: string
  version_number: number
  state: EducatorLibraryItem['state']
  domain: EducatorLibraryItem['domain']
  example_id: string | null
}

export function librarySelect(): string {
  return `SELECT s.id,s.title,s.updated_at,v.id AS version_id,v.version_number,v.state,
    (SELECT domain FROM concept_specs WHERE simulation_version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1) AS domain,
    b.example_id FROM simulations s JOIN simulation_versions v ON v.simulation_id=s.id
    AND NOT EXISTS(SELECT 1 FROM simulation_versions newer WHERE newer.simulation_id=s.id AND newer.version_number>v.version_number)
    LEFT JOIN concept_specs c ON c.id=(SELECT id FROM concept_specs WHERE simulation_version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1)
    LEFT JOIN bundled_examples b ON b.simulation_id=s.id`
}

export function decodeLibraryItem(row: LibraryRow): EducatorLibraryItem {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    latestVersionId: row.version_id,
    versionNumber: row.version_number,
    state: row.state,
    domain: row.domain,
    ownership: row.example_id === null ? 'teacher' : 'bundled',
  }
}

export function bundledMetadata(
  database: DatabaseSync,
  simulationId: string,
): BundledExampleMetadata | null {
  const row = database
    .prepare('SELECT * FROM bundled_examples WHERE simulation_id=?')
    .get(simulationId) as Record<string, unknown> | undefined
  return row === undefined
    ? null
    : {
        exampleId: String(row.example_id),
        exampleVersion: String(row.example_version),
        catalogHash: String(row.catalog_hash),
        simulationId: String(row.simulation_id),
        domain: row.domain as BundledExampleMetadata['domain'],
        licenseId: 'CC-BY-4.0',
        attribution: String(row.attribution),
        installedAt: String(row.installed_at),
      }
}
