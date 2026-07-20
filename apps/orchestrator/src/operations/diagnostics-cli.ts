import { lstat, open } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { type DiagnosticBundle, diagnosticBundleSchema } from './diagnostics-bundle.js'
import { createProcessDiagnosticBundle } from './diagnostics-process.js'

const MAX_BUNDLE_BYTES = 2_097_152
const USAGE =
  'Usage: diagnostics create --output simproof-diagnostics.json [--include logs] [--max-log-events 1..500]\n'

interface BundleOptions {
  readonly includeLogs: boolean
  readonly maxLogEvents: number
}

interface DiagnosticCliOptions {
  readonly argv: readonly string[]
  readonly createBundle?: (options: BundleOptions) => Promise<DiagnosticBundle>
  readonly stdout?: (value: string) => void
  readonly stderr?: (value: string) => void
}

type ParsedArguments = BundleOptions & { readonly output: string }

function optionMap(argv: readonly string[]): ReadonlyMap<string, string> | undefined {
  if (argv[0] !== 'create' || argv.length % 2 === 0) return undefined
  const options = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv.at(index)
    const value = argv.at(index + 1)
    if (flag === undefined || value === undefined || options.has(flag)) return undefined
    options.set(flag, value)
  }
  return options
}

function safeName(path: string): boolean {
  const name = basename(path)
  if (!name.startsWith('simproof-diagnostics') || !name.endsWith('.json')) return false
  const middle = name.slice('simproof-diagnostics'.length, -'.json'.length)
  return (
    (middle.length === 0 || ['-', '_', '.'].includes(middle[0] ?? '')) &&
    [...middle].every(
      (character) =>
        (character >= 'a' && character <= 'z') ||
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') ||
        ['-', '_', '.'].includes(character),
    )
  )
}

const decimalDigits = (value: string): boolean =>
  value.length > 0 && [...value].every((character) => character >= '0' && character <= '9')

function maximumLogEvents(raw: string | undefined, includeLogs: boolean): number | undefined {
  if (raw === undefined) return 200
  if (!includeLogs || !decimalDigits(raw)) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : undefined
}

function parseArguments(argv: readonly string[]): ParsedArguments | undefined {
  const options = optionMap(argv)
  if (
    options === undefined ||
    [...options.keys()].some((key) => !['--output', '--include', '--max-log-events'].includes(key))
  )
    return undefined
  const output = options.get('--output')
  const category = options.get('--include')
  const rawMaximum = options.get('--max-log-events')
  const includeLogs = category === 'logs'
  if (category !== undefined && !includeLogs) return undefined
  if (output === undefined || output === '-' || !safeName(output)) return undefined
  const maxLogEvents = maximumLogEvents(rawMaximum, includeLogs)
  if (maxLogEvents === undefined) return undefined
  return { output, includeLogs, maxLogEvents }
}

async function safeOutputPath(input: string): Promise<string | undefined> {
  if (input.length > 4_096 || input.includes('\0')) return undefined
  const output = resolve(input)
  const parent = dirname(output)
  try {
    const metadata = await lstat(parent)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return undefined
  } catch {
    return undefined
  }
  return output
}

async function writePrivateBundle(path: string, bundle: DiagnosticBundle): Promise<void> {
  const serialized = `${JSON.stringify(diagnosticBundleSchema.parse(bundle))}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new RangeError('Diagnostic bundle exceeds its output bound.')
  }
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.chmod(0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
  await handle.close()
}

export async function runDiagnosticCli(options: DiagnosticCliOptions): Promise<number> {
  const stdout = options.stdout ?? ((value: string) => process.stdout.write(value))
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value))
  const parsed = parseArguments(options.argv)
  if (parsed === undefined) {
    stderr(USAGE)
    return 2
  }
  const output = await safeOutputPath(parsed.output)
  if (output === undefined) {
    stderr('Diagnostic bundle destination is unsafe.\n')
    return 1
  }
  try {
    const bundle = await (options.createBundle ?? createProcessDiagnosticBundle)({
      includeLogs: parsed.includeLogs,
      maxLogEvents: parsed.maxLogEvents,
    })
    await writePrivateBundle(output, bundle)
    stdout('Diagnostic bundle created.\n')
    return 0
  } catch {
    stderr('Diagnostic bundle creation failed.\n')
    return 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  process.exitCode = await runDiagnosticCli({ argv: process.argv.slice(2) })
}
