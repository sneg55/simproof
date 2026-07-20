import type { EducatorSession } from '@simproof/contracts'
import { createContext, type ReactNode, use } from 'react'
import type { EducatorApi } from '@/api/educator-api'

interface SessionContextValue {
  readonly api: EducatorApi
  readonly session: EducatorSession
  readonly expireSession: () => void
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({
  children,
  value,
}: {
  readonly children: ReactNode
  readonly value: SessionContextValue
}) {
  return <SessionContext value={value}>{children}</SessionContext>
}

export function useEducatorSession(): SessionContextValue {
  const value = use(SessionContext)
  if (value === undefined) {
    throw new TypeError('The educator session boundary is missing.')
  }
  return value
}
