import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LocalNdjsonLogReader,
  LocalNdjsonLogStore,
  type OperationalEventId,
  operationalEventIds,
} from './index.js'

const roots: string[] = []
const temporaryRoot = (): string => {
  const root = join(tmpdir(), `simproof-observability-${crypto.randomUUID()}`)
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const signal = (event: OperationalEventId = 'http.request.completed') => ({
  schemaVersion: '1' as const,
  occurredAt: '2026-07-17T12:00:00.000Z',
  severity: 'info' as const,
  component: 'web-api' as const,
  event,
  correlation: { requestId },
})

const config = (root: string) => ({
  root,
  maxEventBytes: 512,
  maxFileBytes: 600,
  maxFiles: 2,
})

describe('bounded local NDJSON operational log store', () => {
  it('creates an owned directory and fixed file with restrictive modes', () => {
    const root = temporaryRoot()
    const store = new LocalNdjsonLogStore(config(root))
    store.write(signal())

    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(readdirSync(root)).toEqual(['operational.ndjson'])
    expect(statSync(join(root, 'operational.ndjson')).mode & 0o777).toBe(0o600)
  })

  it('strictly validates signals before append and enforces the event byte cap', () => {
    const root = temporaryRoot()
    const store = new LocalNdjsonLogStore(config(root))
    expect(() => store.write({ ...signal(), prompt: 'teacher secret' })).toThrow()
    const sizeCappedStore = new LocalNdjsonLogStore({ ...config(root), maxEventBytes: 128 })
    expect(() => sizeCappedStore.write(signal())).toThrow()
    expect(readdirSync(root)).toEqual([])
  })

  it('rotates only fixed owned files within the configured count and reads newest records', () => {
    const root = temporaryRoot()
    const store = new LocalNdjsonLogStore(config(root))
    for (let index = 0; index < 12; index += 1) {
      store.write(signal(operationalEventIds.at(index) ?? 'http.request.completed'))
    }
    expect(readdirSync(root).sort()).toEqual(['operational-1.ndjson', 'operational.ndjson'])
    const result = store.readRecent({ limit: 2 })
    expect(result.events.map(({ event }) => event)).toEqual([
      operationalEventIds.at(10),
      operationalEventIds.at(11),
    ])
    expect(result.truncated).toBe(true)
  })

  it('drops malformed or schema-invalid lines without copying raw content', () => {
    const root = temporaryRoot()
    const store = new LocalNdjsonLogStore(config(root))
    store.write(signal())
    appendFileSync(
      join(root, 'operational.ndjson'),
      '{"prompt":"retained teacher prompt"}\nnot-json\n',
      'utf8',
    )
    const result = store.readRecent({ limit: 10 })
    expect(result.events).toEqual([signal()])
    expect(result.rejectedLineCount).toBe(2)
    expect(JSON.stringify(result)).not.toContain('retained teacher prompt')
  })

  it('rejects symlink roots, symlink files, unexpected names, and non-regular targets', () => {
    const parent = temporaryRoot()
    mkdirSync(parent, { recursive: true })
    const target = join(parent, 'target')
    const linkedRoot = join(parent, 'linked')
    mkdirSync(target)
    symlinkSync(target, linkedRoot)
    expect(() => new LocalNdjsonLogStore(config(linkedRoot))).toThrow()

    const root = join(parent, 'logs')
    const store = new LocalNdjsonLogStore(config(root))
    writeFileSync(join(root, 'unexpected.txt'), 'unsafe')
    expect(() => store.readRecent({ limit: 10 })).toThrow()
    rmSync(join(root, 'unexpected.txt'))

    const external = join(parent, 'external.ndjson')
    writeFileSync(external, '')
    symlinkSync(external, join(root, 'operational.ndjson'))
    expect(() => store.write(signal())).toThrow()
  })

  it('repairs overly permissive owned modes before use', () => {
    const root = temporaryRoot()
    const store = new LocalNdjsonLogStore(config(root))
    store.write(signal())
    chmodSync(root, 0o755)
    chmodSync(join(root, 'operational.ndjson'), 0o644)
    store.readRecent({ limit: 10 })
    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, 'operational.ndjson')).mode & 0o777).toBe(0o600)
  })

  it('offers an offline reader that neither creates nor chmods diagnostic storage', () => {
    const missing = temporaryRoot()
    const absentReader = new LocalNdjsonLogReader(config(missing))
    expect(absentReader.readRecent({ limit: 10 })).toEqual({
      available: false,
      events: [],
      rejectedLineCount: 0,
      truncated: false,
    })
    expect(existsSync(missing)).toBe(false)

    const root = temporaryRoot()
    mkdirSync(root, { mode: 0o755 })
    writeFileSync(join(root, 'operational.ndjson'), `${JSON.stringify(signal())}\n`, {
      mode: 0o644,
    })
    chmodSync(root, 0o755)
    chmodSync(join(root, 'operational.ndjson'), 0o644)
    const reader = new LocalNdjsonLogReader(config(root))
    expect(reader.readRecent({ limit: 10 })).toMatchObject({ available: true, events: [signal()] })
    expect(statSync(root).mode & 0o777).toBe(0o755)
    expect(statSync(join(root, 'operational.ndjson')).mode & 0o777).toBe(0o644)
  })
})
