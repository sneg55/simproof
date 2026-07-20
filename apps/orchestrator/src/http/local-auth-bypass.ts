import { randomBytes, randomUUID } from 'node:crypto'

import { type EducatorSession, educatorSessionSchema } from '@simproof/contracts'
import type { ServerConfig } from '../config/environment.js'

export interface LocalAuthBypass {
  readonly session: EducatorSession
  readonly sessionId: string
}

export function createLocalAuthBypass(config: ServerConfig): LocalAuthBypass | undefined {
  if (!config.localAuthBypass) return undefined
  const expiresAt = new Date(Date.now() + config.session.ttlSeconds * 1_000).toISOString()
  return {
    sessionId: randomUUID(),
    session: educatorSessionSchema.parse({
      authenticated: true,
      authenticationMode: 'local-bypass',
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt,
    }),
  }
}
