import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateWorkflow } from './check-ci-workflow.mjs'

const COMMENT_SPOOF_PATH = new URL(
  '../tests/fixtures/ci-workflow/comment-spoof.yml',
  import.meta.url,
)

test('rejects comments that only look like the required workflow structure', async () => {
  const source = await readFile(COMMENT_SPOOF_PATH, 'utf8')
  const failures = validateWorkflow(source)

  assert.ok(failures.some((failure) => failure.includes('workflow triggers')))
  assert.ok(failures.some((failure) => failure.includes('permissions')))
  assert.ok(failures.some((failure) => failure.includes('verify job')))
})
