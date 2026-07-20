import type {
  GenerationExternalCall,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  GenerationProviderReservation,
  RecordExternalCallInput,
  ReserveExternalCallInput,
  StartGenerationAttemptInput,
} from './generation-types.js'
import { err, ok, type Result } from './types.js'

const INVALID_STATE = 'invalid-state'

export function validateAttemptStart(
  run: GenerationPipelineRun,
  attempts: readonly GenerationPipelineAttempt[],
  input: StartGenerationAttemptInput,
): Result<true> {
  const expectedState = input.attemptNumber === 1 ? 'generating' : 'repairing'
  if (run.state !== expectedState) {
    return err(INVALID_STATE, `Attempt ${input.attemptNumber} cannot start while ${run.state}.`)
  }
  if (input.attemptNumber > run.maxAttempts) {
    return err('invalid-input', 'Generation attempt exceeds its run cap.')
  }
  if (input.attemptNumber !== attempts.length + 1) {
    return err('invalid-input', 'Generation attempts must be contiguous and unique.')
  }
  if (attempts.some(({ outcome }) => outcome === 'pending')) {
    return err(INVALID_STATE, 'The prior generation attempt is still active.')
  }
  return ok(true)
}

export function validateExternalCallHistory(
  run: GenerationPipelineRun,
  attempts: readonly GenerationPipelineAttempt[],
  calls: readonly GenerationExternalCall[],
  input: RecordExternalCallInput,
): Result<true> {
  return validateExternalOperation(run, attempts, calls, input)
}

export function validateReservationHistory(context: {
  readonly run: GenerationPipelineRun
  readonly attempts: readonly GenerationPipelineAttempt[]
  readonly calls: readonly GenerationExternalCall[]
  readonly reservations: readonly GenerationProviderReservation[]
  readonly input: ReserveExternalCallInput
}): Result<true> {
  if (context.reservations.some(({ status }) => status === 'pending')) {
    return err(INVALID_STATE, 'A provider reservation is already pending for this run.')
  }
  return validateExternalOperation(context.run, context.attempts, context.calls, context.input)
}

function validateExternalOperation(
  run: GenerationPipelineRun,
  attempts: readonly GenerationPipelineAttempt[],
  calls: readonly GenerationExternalCall[],
  input: RecordExternalCallInput | ReserveExternalCallInput,
): Result<true> {
  return input.operation === 'concept_compile'
    ? validateConceptCall(run, attempts, calls)
    : validateCodeCall(run, attempts, calls, input)
}

function validateCodeCall(
  run: GenerationPipelineRun,
  attempts: readonly GenerationPipelineAttempt[],
  calls: readonly GenerationExternalCall[],
  input: RecordExternalCallInput | ReserveExternalCallInput,
): Result<true> {
  const current = attempts.at(-1)
  const expectedState = input.operation === 'code_generate' ? 'generating' : 'repairing'
  const validNumber =
    current !== undefined &&
    (input.operation === 'code_generate' ? current.attemptNumber === 1 : current.attemptNumber > 1)
  if (
    run.state !== expectedState ||
    current === undefined ||
    current.id !== input.attemptId ||
    current.outcome !== 'pending' ||
    !validNumber
  ) {
    return err(INVALID_STATE, 'Code provider call does not match the current pending attempt.')
  }
  if (
    current.provider !== input.provider ||
    current.modelId !== input.modelId ||
    current.templateVersion !== input.templateVersion
  ) {
    return err('invalid-input', 'Code provider call provenance differs from its attempt.')
  }
  if (
    calls.some(({ attemptId, stableErrorId }) => attemptId === current.id && stableErrorId === null)
  ) {
    return err(INVALID_STATE, 'The current attempt already has a successful code provider call.')
  }
  return ok(true)
}

function validateConceptCall(
  run: GenerationPipelineRun,
  attempts: readonly GenerationPipelineAttempt[],
  calls: readonly GenerationExternalCall[],
): Result<true> {
  if (run.state !== 'compiling' || attempts.length !== 0) {
    return err(INVALID_STATE, 'Concept compilation is allowed only before generation attempts.')
  }
  if (
    calls.some(
      ({ operation, stableErrorId }) => operation === 'concept_compile' && stableErrorId === null,
    )
  ) {
    return err(INVALID_STATE, 'The concept has already been compiled successfully.')
  }
  return ok(true)
}
