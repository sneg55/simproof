import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const localManifest = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  'apps/orchestrator/package.json',
)
const productionManifest = resolve(fileURLToPath(new URL('..', import.meta.url)), 'package.json')

export async function importRuntimePackage(name) {
  const require = createRequire(existsSync(localManifest) ? localManifest : productionManifest)
  return await import(pathToFileURL(require.resolve(name)).href)
}
