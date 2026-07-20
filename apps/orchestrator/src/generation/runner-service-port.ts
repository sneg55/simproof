import type { RunnerResponse } from '@simproof/contracts'

export interface RunnerServicePort {
  readonly execute: (input: unknown, signal?: AbortSignal) => Promise<RunnerResponse>
}
