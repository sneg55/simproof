import { describe, expect, it } from 'vitest'

import {
  createProviderCallReservation,
  estimatedCostMicrousd,
  failedCallUsage,
} from './metering-policy.js'

describe('provider metering policy', () => {
  it('rejects non-positive or unsafe pre-dispatch reservations', () => {
    expect(() =>
      createProviderCallReservation({
        inputTokens: 1,
        outputTokens: 0,
        requestCount: 1,
        costMicrousd: 1,
      }),
    ).toThrow(RangeError)
  })

  it('fails closed when an estimator returns no charge for token usage', () => {
    expect(
      estimatedCostMicrousd(
        {
          estimateCostMicrousd: () => 0,
          failedCallUsage: { inputTokens: 1, outputTokens: 1, costMicrousd: 1 },
        },
        { inputTokens: 1, outputTokens: 0 },
      ),
    ).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('fails closed when failed-call reservation is empty', () => {
    expect(
      failedCallUsage({
        estimateCostMicrousd: () => 1,
        failedCallUsage: { inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
      }),
    ).toEqual({
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: Number.MAX_SAFE_INTEGER,
      costMicrousd: Number.MAX_SAFE_INTEGER,
    })
  })
})
