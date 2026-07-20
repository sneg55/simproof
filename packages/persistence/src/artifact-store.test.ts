import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { probeArtifactRoot } from './artifact-readiness.js'
import { ArtifactStore } from './artifact-store.js'
import { expectOk, sha } from './test-helpers.js'

const roots: string[] = []
async function root(name: string) {
  const path = await mkdtemp(join(tmpdir(), `simproof-${name}-`))
  roots.push(path)
  return path
}
afterEach(
  async () =>
    await Promise.all(roots.splice(0).map((path) => rm(path, { force: true, recursive: true }))),
)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('content-addressed artifact store', () => {
  it('probes a safe readable and writable artifact root without creating an object', async () => {
    const store = new ArtifactStore(await root('readiness'))

    expect(await store.readiness()).toEqual({ ok: true, value: true })
    expect(await store.identities()).toEqual({ ok: true, value: [] })
    expect(await readdir(store.root)).toEqual(['sha256'])
  })

  it('keeps readiness constant-size without scanning artifact identities', async () => {
    const store = new ArtifactStore(await root('readiness-bounded'))
    const inventory = vi
      .spyOn(store, 'identities')
      .mockRejectedValue(new TypeError('Readiness must not scan the artifact inventory.'))

    expect(await store.readiness()).toEqual({ ok: true, value: true })
    expect(inventory).not.toHaveBeenCalled()
  })

  it('supports overlapping readiness probes without invalid inventory or residue', async () => {
    const entered = deferred()
    const release = deferred()
    let arrivals = 0
    const store = new ArtifactStore(
      await root('readiness-overlap'),
      async (path) =>
        await probeArtifactRoot(path, {
          afterWrite: async () => {
            arrivals += 1
            if (arrivals === 2) entered.resolve()
            await release.promise
          },
        }),
    )

    const probes = [store.readiness(), store.readiness()]
    await entered.promise
    expect(await store.identities()).toEqual({ ok: true, value: [] })
    release.resolve()

    await expect(Promise.all(probes)).resolves.toEqual([
      { ok: true, value: true },
      { ok: true, value: true },
    ])
    expect(await store.identities()).toEqual({ ok: true, value: [] })
    expect(
      (await readdir(join(store.root, 'sha256'), { recursive: true })).filter((entry) =>
        entry.endsWith('.tmp'),
      ),
    ).toEqual([])
  })

  it('allows a normal artifact publication while a readiness probe is open', async () => {
    const entered = deferred()
    const release = deferred()
    const store = new ArtifactStore(
      await root('readiness-put-overlap'),
      async (path) =>
        await probeArtifactRoot(path, {
          afterWrite: async () => {
            entered.resolve()
            await release.promise
          },
        }),
    )

    const readiness = store.readiness()
    await entered.promise
    const object = expectOk(
      await store.putSource('published during readiness 199', { normalizationVersion: 1 }),
    )
    expect(object.hash.slice(7, 9)).toBe(sha('simproof-artifact-readiness-v2').slice(7, 9))
    expect(await store.identities()).toEqual({ ok: true, value: [object.hash] })
    release.resolve()

    await expect(readiness).resolves.toEqual({ ok: true, value: true })
    await expect(store.get(object.hash)).resolves.toMatchObject({ ok: true })
    expect(await store.identities()).toEqual({ ok: true, value: [object.hash] })
    expect(
      (await readdir(join(store.root, 'sha256'), { recursive: true })).filter((entry) =>
        entry.endsWith('.tmp'),
      ),
    ).toEqual([])
  })

  it('normalizes, deduplicates, and publishes same-content races without temp residue', async () => {
    const store = new ArtifactStore(await root('race'))
    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.putSource('line\r\n', { normalizationVersion: 1 })),
    )
    expect(
      new Set(results.filter((result) => result.ok).map((result) => result.value.hash)).size,
    ).toBe(1)
    expect(results.filter((result) => result.ok && result.value.created)).toHaveLength(1)
    const hash = expectOk(results[0]!).hash
    expect(
      await store.putSource('other', { normalizationVersion: 1, expectedHash: hash }),
    ).toMatchObject({
      ok: false,
      error: { code: 'hash-mismatch' },
    })
    expect(
      (await readdir(join(store.root, 'sha256', hash.slice(7, 9)))).some((name) =>
        name.endsWith('.tmp'),
      ),
    ).toBe(false)
  })

  it('detects corruption and missing objects', async () => {
    const store = new ArtifactStore(await root('integrity'))
    const object = expectOk(await store.putSource('trusted', { normalizationVersion: 1 }))
    await writeFile(store.pathForHash(object.hash), 'tampered')
    expect(await store.get(object.hash)).toMatchObject({
      ok: false,
      error: { code: 'corrupt-artifact' },
    })
    expect(await store.get(sha('missing'))).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
  })

  it('canonicalizes equivalent JSON key order under explicit normalization version', async () => {
    const store = new ArtifactStore(await root('json'))
    const first = expectOk(await store.putJson('{"b":2,"a":1}', { normalizationVersion: 1 }))
    const second = expectOk(await store.putJson({ a: 1, b: 2 }, { normalizationVersion: 1 }))
    expect(second.hash).toBe(first.hash)
    await expect(readFile(store.pathForHash(first.hash), 'utf8')).resolves.toBe('{"a":1,"b":2}')
  })

  it('never follows prefix/root symlinks or deletes an outside sentinel', async () => {
    const dataRoot = await root('symlink-store')
    const outside = await root('symlink-outside')
    const hash = sha('target')
    const outsideTarget = join(outside, hash.slice(9))
    await writeFile(outsideTarget, 'untouched')
    const store = new ArtifactStore(
      dataRoot,
      async (path) => await probeArtifactRoot(path, { probeBytes: Buffer.from('target', 'utf8') }),
    )
    await mkdir(join(dataRoot, 'sha256'))
    await symlink(outside, join(dataRoot, 'sha256', hash.slice(7, 9)))
    expect(await store.readiness()).toMatchObject({ ok: false })
    expect((await readdir(dataRoot)).some((name) => name.startsWith('.readiness-'))).toBe(false)
    expect(await store.delete(hash)).toMatchObject({ ok: false })
    expect(await store.auditAndCollect([])).toMatchObject({
      ok: false,
      error: { code: 'corrupt-artifact' },
    })
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('untouched')
  })

  it('fails closed on referenced corruption before deleting a valid orphan', async () => {
    const store = new ArtifactStore(await root('audit'))
    const referenced = expectOk(await store.putSource('referenced', { normalizationVersion: 1 }))
    const orphan = expectOk(await store.putSource('orphan', { normalizationVersion: 1 }))
    await writeFile(store.pathForHash(referenced.hash), 'corrupt')
    expect(await store.auditAndCollect([referenced.hash])).toMatchObject({ ok: false })
    expect(await store.get(orphan.hash)).toMatchObject({ ok: true })
  })

  it('reports orphans in dry-run and collects only when explicitly enabled', async () => {
    const store = new ArtifactStore(await root('collect'))
    const orphan = expectOk(await store.putSource('orphan', { normalizationVersion: 1 }))
    expect(await store.auditAndCollect([])).toMatchObject({
      ok: true,
      value: {
        orphanedArtifacts: [orphan.hash],
        deletedArtifacts: [],
        skippedArtifacts: [orphan.hash],
        deferredArtifacts: [],
      },
    })
    expect(await store.get(orphan.hash)).toMatchObject({ ok: true })
    expect(await store.auditAndCollect([], { dryRun: false, minimumAgeMs: 0 })).toMatchObject({
      ok: true,
    })
    expect(await store.get(orphan.hash)).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})
