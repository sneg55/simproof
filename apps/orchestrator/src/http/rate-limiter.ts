import { isIP } from 'node:net'

export type LimitFailure = { readonly ok: false; readonly reason: 'rate' | 'concurrency' }
export type LimitLease = { readonly ok: true; release(): void }

interface KeyState {
  windowStartedAt: number
  attempts: number
  concurrent: number
  lastSeenAt: number
}

export class AuthAttemptLimiter {
  readonly #options: {
    windowMs: number
    globalAttempts: number
    sourceAttempts: number
    sessionAttempts: number
    globalConcurrent: number
    sourceConcurrent: number
    sessionConcurrent: number
    maxTrackedSources: number
    maxTrackedSessions: number
    now: () => number
  }
  readonly #sources = new Map<string, KeyState>()
  readonly #sessions = new Map<string, KeyState>()
  #globalWindowStartedAt: number
  #globalAttempts = 0
  #globalConcurrent = 0

  constructor(
    options: {
      readonly windowMs?: number
      readonly globalAttempts?: number
      readonly sourceAttempts?: number
      readonly sessionAttempts?: number
      readonly globalConcurrent?: number
      readonly sourceConcurrent?: number
      readonly sessionConcurrent?: number
      readonly maxTrackedSources?: number
      readonly maxTrackedSessions?: number
      readonly now?: () => number
    } = {},
  ) {
    this.#options = {
      windowMs: options.windowMs ?? 60_000,
      globalAttempts: options.globalAttempts ?? 60,
      sourceAttempts: options.sourceAttempts ?? 8,
      sessionAttempts: options.sessionAttempts ?? 8,
      globalConcurrent: options.globalConcurrent ?? 4,
      sourceConcurrent: options.sourceConcurrent ?? 1,
      sessionConcurrent: options.sessionConcurrent ?? 1,
      maxTrackedSources: options.maxTrackedSources ?? 1_024,
      maxTrackedSessions: options.maxTrackedSessions ?? 1_024,
      now: options.now ?? Date.now,
    }
    const numericBounds = [
      this.#options.windowMs,
      this.#options.globalAttempts,
      this.#options.sourceAttempts,
      this.#options.sessionAttempts,
      this.#options.globalConcurrent,
      this.#options.sourceConcurrent,
      this.#options.sessionConcurrent,
      this.#options.maxTrackedSources,
      this.#options.maxTrackedSessions,
    ]
    if (numericBounds.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError('Authentication limiter configuration is invalid.')
    }
    this.#globalWindowStartedAt = this.#options.now()
  }

  acquire(source: string, session?: string): LimitLease | LimitFailure {
    const now = this.#options.now()
    this.#resetGlobalWindow(now)
    const sourceState = this.#state(this.#sources, source, now, this.#options.maxTrackedSources)
    const sessionState =
      session === undefined
        ? undefined
        : this.#state(this.#sessions, session, now, this.#options.maxTrackedSessions)
    if (sourceState === undefined || (session !== undefined && sessionState === undefined)) {
      return { ok: false, reason: 'rate' }
    }
    this.#resetKeyWindow(sourceState, now)
    if (sessionState !== undefined) this.#resetKeyWindow(sessionState, now)
    if (
      this.#globalConcurrent >= this.#options.globalConcurrent ||
      sourceState.concurrent >= this.#options.sourceConcurrent ||
      (sessionState !== undefined && sessionState.concurrent >= this.#options.sessionConcurrent)
    ) {
      return { ok: false, reason: 'concurrency' }
    }
    if (
      this.#globalAttempts >= this.#options.globalAttempts ||
      sourceState.attempts >= this.#options.sourceAttempts ||
      (sessionState !== undefined && sessionState.attempts >= this.#options.sessionAttempts)
    ) {
      return { ok: false, reason: 'rate' }
    }
    this.#globalAttempts += 1
    this.#globalConcurrent += 1
    sourceState.attempts += 1
    sourceState.concurrent += 1
    sourceState.lastSeenAt = now
    if (sessionState !== undefined) {
      sessionState.attempts += 1
      sessionState.concurrent += 1
      sessionState.lastSeenAt = now
    }
    let active = true
    return {
      ok: true,
      release: () => {
        if (!active) return
        active = false
        this.#globalConcurrent -= 1
        sourceState.concurrent -= 1
        if (sessionState !== undefined) sessionState.concurrent -= 1
      },
    }
  }

  trackedSources(): number {
    return this.#sources.size
  }

  #state(
    states: Map<string, KeyState>,
    key: string,
    now: number,
    maximumTracked: number,
  ): KeyState | undefined {
    const existing = states.get(key)
    if (existing !== undefined) return existing
    if (states.size >= maximumTracked) this.#evictExpiredInactive(states, now, maximumTracked)
    if (states.size >= maximumTracked) return undefined
    const created = { windowStartedAt: now, attempts: 0, concurrent: 0, lastSeenAt: now }
    states.set(key, created)
    return created
  }

  #evictExpiredInactive(states: Map<string, KeyState>, now: number, maximumTracked: number): void {
    for (const [key, state] of states) {
      if (state.concurrent === 0 && now - state.windowStartedAt >= this.#options.windowMs) {
        states.delete(key)
      }
      if (states.size < maximumTracked) return
    }
  }

  #resetGlobalWindow(now: number): void {
    if (now - this.#globalWindowStartedAt < this.#options.windowMs) return
    this.#globalWindowStartedAt = now
    this.#globalAttempts = 0
  }

  #resetKeyWindow(state: KeyState, now: number): void {
    if (now - state.windowStartedAt < this.#options.windowMs) return
    state.windowStartedAt = now
    state.attempts = 0
  }
}

export function trustedClientSource(
  peerAddress: string,
  forwardedFor: string | undefined,
  trustedProxyAddress: string | undefined,
): string {
  return peerAddress === trustedProxyAddress &&
    forwardedFor !== undefined &&
    isIP(forwardedFor) !== 0
    ? forwardedFor
    : peerAddress
}
