import { describe, expect, it } from 'vitest'

import {
  publicationNoticeFromRouteState,
  publicationSuccessRouteState,
} from '@/library/simulation-route-state'

describe('simulation route state', () => {
  it('round trips the bounded publication notice', () => {
    const state = publicationSuccessRouteState(3)
    expect(publicationNoticeFromRouteState(state)).toEqual({
      kind: 'publication-success',
      versionNumber: 3,
    })
  })

  it.each([
    null,
    { notice: { kind: 'publication-success', versionNumber: 0 } },
    { notice: { kind: 'publication-success', versionNumber: 1, message: '<script>' } },
    { notice: { kind: 'other', versionNumber: 1 } },
    { notice: { kind: 'publication-success', versionNumber: 1 }, extra: true },
  ])('rejects unbounded or malformed route state', (value) => {
    expect(publicationNoticeFromRouteState(value)).toBeUndefined()
  })
})
