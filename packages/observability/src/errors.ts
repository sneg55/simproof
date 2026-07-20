import { z } from 'zod'

import { type Correlation, correlationSchema } from './correlation.js'
import {
  getOperationalErrorDefinition,
  type OperationalErrorId,
  operationalErrorIdSchema,
} from './error-registry.js'

interface OperationalErrorOptions {
  readonly correlation?: Correlation
  readonly cause?: unknown
}

export class OperationalError extends Error {
  readonly correlation: Correlation | undefined
  readonly errorId: OperationalErrorId
  readonly retryable: boolean
  readonly clientStatus: number

  constructor(errorId: OperationalErrorId, options: OperationalErrorOptions = {}) {
    const registered = getOperationalErrorDefinition(errorId)
    super(registered.safeClientMessage, { cause: options.cause })
    this.name = 'OperationalError'
    this.errorId = errorId
    this.correlation =
      options.correlation === undefined ? undefined : correlationSchema.parse(options.correlation)
    this.retryable = registered.retryable
    this.clientStatus = registered.clientStatus
  }
}

export const createOperationalError = (
  errorId: OperationalErrorId,
  options?: OperationalErrorOptions,
): OperationalError => new OperationalError(errorId, options)

export const safeClientErrorSchema = z
  .object({
    errorId: operationalErrorIdSchema,
    message: z.string().trim().min(1).max(200),
    requestId: z.uuid().optional(),
  })
  .strict()

export type SafeClientError = z.infer<typeof safeClientErrorSchema>

export const toSafeClientError = (error: OperationalError): SafeClientError =>
  safeClientErrorSchema.parse({
    errorId: error.errorId,
    message: getOperationalErrorDefinition(error.errorId).safeClientMessage,
    ...(error.correlation?.requestId === undefined
      ? {}
      : { requestId: error.correlation.requestId }),
  })
