import { execFileSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_FILE_BYTES = 1_048_576
const FIXTURE_PATH = 'tests/repository/fixtures/secret-canary.txt'
const REDACTION_FIXTURES = new Set([
  FIXTURE_PATH,
  'packages/observability/src/errors.test.ts',
  'packages/observability/src/redaction.test.ts',
  'tests/fixtures/security/diagnostic-redaction.json',
])
const PATTERNS = Object.freeze([
  ['private-key', /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/gu],
  ['openai-api-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/gu],
  ['github-token', /\b(?:gh[opsu]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/gu],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['test-canary', /\bSIMPROOF_FAKE_SECRET_[A-Z0-9]{24}\b/gu],
])

export async function scanSecretFiles(paths, options = {}) {
  const base = resolve(options.root ?? root)
  const findings = []
  for (const path of paths) {
    const absolute = resolve(base, path)
    if (!absolute.startsWith(`${base}/`))
      throw new TypeError('Secret scan path escapes the repository.')
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new TypeError(`Secret scan refuses non-regular path: ${relative(base, absolute)}`)
    }
    if (metadata.size > MAX_FILE_BYTES) continue
    const content = await readFile(absolute)
    if (content.includes(0)) continue
    const source = content.toString('utf8')
    for (const [rule, pattern] of PATTERNS) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) {
        findings.push({
          path: relative(base, absolute),
          line: lineNumber(source, match.index),
          rule,
        })
      }
    }
  }
  return findings
}

function lineNumber(source, index) {
  let line = 1
  for (let offset = 0; offset < index; offset += 1) if (source.codePointAt(offset) === 10) line += 1
  return line
}

function repositoryFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path !== '' && !REDACTION_FIXTURES.has(path))
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  try {
    const requested = process.argv.slice(2)
    const paths = requested.length === 0 ? repositoryFiles() : requested
    const findings = await scanSecretFiles(paths)
    if (findings.length > 0) {
      for (const finding of findings) {
        process.stderr.write(`${finding.path}:${finding.line}: possible secret (${finding.rule})\n`)
      }
      process.exitCode = 1
    } else {
      process.stdout.write(`Secret preflight checked ${paths.length} repository files.\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
