import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const REVIEW_THRESHOLD = 300
const HARD_LIMIT = 400
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const SOURCE_ROOTS = ['apps', 'packages']
const EXEMPT_PATH_SEGMENTS = new Set(['fixtures', 'generated', 'migrations', 'test-vectors'])
const EXEMPT_FILE_PATTERNS = [
  /\.generated\.[^.]+$/u,
  /(?:^|[.-])schema\.[^.]+$/u,
  /(?:^|[.-])table\.[^.]+$/u,
]

async function collectSourceFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
        files.push(...(await collectSourceFiles(entryPath)))
      }
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }
  return files
}

function countLinesOfCode(source) {
  let inBlockComment = false
  let count = 0

  for (const originalLine of source.split(/\r?\n/u)) {
    let line = originalLine.trim()
    if (line.length === 0) continue

    while (line.length > 0) {
      if (inBlockComment) {
        const blockEnd = line.indexOf('*/')
        if (blockEnd === -1) {
          line = ''
          continue
        }
        inBlockComment = false
        line = line.slice(blockEnd + 2).trim()
        continue
      }

      if (line.startsWith('//')) {
        line = ''
        continue
      }
      if (line.startsWith('/*')) {
        inBlockComment = true
        line = line.slice(2).trim()
        continue
      }

      count += 1
      line = ''
    }
  }

  return count
}

function getExemption(filePath, source) {
  const segments = filePath.split(path.sep)
  const fileName = path.basename(filePath)

  if (segments.some((segment) => EXEMPT_PATH_SEGMENTS.has(segment))) {
    return 'exempt path category'
  }
  if (EXEMPT_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return 'exempt declarative or generated file category'
  }

  const leadingComment = source.split(/\r?\n/u).slice(0, 20).join('\n')
  const marker = leadingComment.match(/LOC-EXEMPT:\s*(\S.*)$/mu)
  return marker?.[1]
}

const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat().sort()
const review = []
const violations = []

for (const filePath of files) {
  const source = await readFile(filePath, 'utf8')
  const loc = countLinesOfCode(source)
  const exemption = getExemption(filePath, source)

  if (loc > HARD_LIMIT && exemption === undefined) {
    violations.push({ filePath, loc })
  } else if (loc > REVIEW_THRESHOLD && exemption === undefined) {
    review.push({ filePath, loc })
  }
}

for (const item of review) {
  console.warn(`REVIEW ${item.filePath}: ${item.loc} LOC exceeds ${REVIEW_THRESHOLD}`)
}
for (const item of violations) {
  console.error(`ERROR ${item.filePath}: ${item.loc} LOC exceeds hard limit ${HARD_LIMIT}`)
}

if (violations.length > 0) process.exitCode = 1
