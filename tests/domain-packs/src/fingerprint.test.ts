import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inventoryAttackMatrix } from './fingerprint.js'

describe('domain-pack inventory path defenses', () => {
  it('rejects each complete malicious inventory through its specific defense', () => {
    const attacks = inventoryAttackMatrix()

    expect(attacks.traversal).toMatchObject({ complete: true, canonical: false })
    expect(attacks.absolute).toMatchObject({ complete: true, canonical: false })
    expect(attacks.finalSymlink).toMatchObject({ complete: true, regularFiles: false })
    expect(attacks.intermediateSymlink).toMatchObject({ complete: true, regularFiles: false })
    expect(attacks.directory).toMatchObject({ complete: true, regularFiles: false })
    expect(attacks.device).toMatchObject({ complete: true, regularFiles: false })
  })

  it('uses the production generator defense to reject an intermediate symlink', async () => {
    const generatorUrl = new URL(
      '../../../scripts/generate-domain-pack-fingerprints.mjs',
      import.meta.url,
    )
    const generator = (await import(generatorUrl.href)) as {
      assertNoSymlinkSegments: (root: string, absolute: string, inventoryEntry: string) => void
    }
    const root = mkdtempSync(join(tmpdir(), 'simproof-generator-path-'))
    try {
      mkdirSync(resolve(root, 'actual'))
      writeFileSync(resolve(root, 'actual/source.ts'), 'export const value = true\n', 'utf8')
      symlinkSync('actual', resolve(root, 'linked'))

      expect(() =>
        generator.assertNoSymlinkSegments(
          root,
          resolve(root, 'actual/source.ts'),
          'actual/source.ts',
        ),
      ).not.toThrow()
      expect(() =>
        generator.assertNoSymlinkSegments(
          root,
          resolve(root, 'linked/source.ts'),
          'linked/source.ts',
        ),
      ).toThrow(/symbolic link/iu)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
