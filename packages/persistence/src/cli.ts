import { createPersistence } from './database.js'
import { databasePathFromProcess } from './environment.js'

const database = createPersistence(databasePathFromProcess())
try {
  const result = database.migrate()
  if (!result.ok) {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Applied migrations: ${result.value.applied.join(',') || 'none'}\n`)
  }
} finally {
  database.close()
}
