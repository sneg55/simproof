import type { ProjectileInput, VerificationFinding } from '@simproof/contracts'

interface RelativeFindingOptions {
  readonly id: string
  readonly checkId: string
  readonly quantity: string
  readonly input: ProjectileInput
  readonly expected: number
  readonly actual: number
  readonly tolerance: number
  readonly unit: string
  readonly explanation: string
  readonly category?: 'mismatch' | 'invariant'
}

interface AbsoluteFindingOptions extends Omit<RelativeFindingOptions, 'tolerance'> {
  readonly allowedError: number
}

function measuredInputs(input: ProjectileInput): VerificationFinding['inputs'] {
  return {
    initialSpeedMps: { value: input.initialSpeedMps, unit: 'm/s' },
    launchAngleDeg: { value: input.launchAngleDeg, unit: 'deg' },
  }
}

export function relativeFinding(options: RelativeFindingOptions): VerificationFinding {
  const error = Math.abs(options.actual - options.expected) / Math.abs(options.expected)
  return {
    id: options.id,
    category: options.category ?? 'mismatch',
    severity: 'error',
    checkId: options.checkId,
    quantity: options.quantity,
    inputs: measuredInputs(options.input),
    expected: { value: options.expected, unit: options.unit },
    actual: { value: options.actual, unit: options.unit },
    tolerance: { mode: 'relative', relative: options.tolerance },
    error: { mode: 'relative', value: error },
    explanation: options.explanation,
  }
}

export function absoluteFinding(options: AbsoluteFindingOptions): VerificationFinding {
  return {
    id: options.id,
    category: options.category ?? 'invariant',
    severity: 'error',
    checkId: options.checkId,
    quantity: options.quantity,
    inputs: measuredInputs(options.input),
    expected: { value: options.expected, unit: options.unit },
    actual: { value: options.actual, unit: options.unit },
    tolerance: { mode: 'absolute', absolute: options.allowedError, unit: options.unit },
    error: {
      mode: 'absolute',
      value: Math.abs(options.actual - options.expected),
      unit: options.unit,
    },
    explanation: options.explanation,
  }
}
