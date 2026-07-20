import { describe, expect, it, vi } from 'vitest'
import { createEducatorApi } from '@/api/educator-api'
import type { HttpClient } from '@/api/http-client'

describe('educator API', () => {
  it('sends sign-out through the authenticated CSRF-protected endpoint', async () => {
    const request = vi
      .fn<HttpClient['request']>()
      .mockResolvedValue({ ok: true, value: true } as never)
    const csrfToken = 'c'.repeat(43)

    await expect(
      createEducatorApi({ request: request as HttpClient['request'] }).logout(csrfToken),
    ).resolves.toEqual({
      ok: true,
      value: true,
    })
    expect(request).toHaveBeenCalledWith('/api/auth/logout', expect.anything(), {
      method: 'POST',
      csrfToken,
    })
  })
})
