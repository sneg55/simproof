import { describe, expect, it } from 'vitest'

import {
  libraryRouteNotice,
  libraryRouteNoticeMessage,
  parseLibraryRouteNotice,
} from '@/library/library-route-notice'

describe('library route notices', () => {
  it('accepts bounded operation state and rejects malformed or expanded state', () => {
    const notice = libraryRouteNotice('archive', 'Pendulum lesson')
    expect(parseLibraryRouteNotice(notice)).toEqual(notice)
    expect(libraryRouteNoticeMessage(notice)).toBe('Archived Pendulum lesson')
    expect(parseLibraryRouteNotice({ ...notice, injected: '<script>' })).toBeNull()
    expect(parseLibraryRouteNotice({ ...notice, title: 'x'.repeat(121) })).toBeNull()
  })
})
