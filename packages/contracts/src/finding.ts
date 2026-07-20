import { z } from 'zod'

import {
  fieldIdentifierSchema,
  identifierSchema,
  measuredValueSchema,
  toleranceSchema,
} from './primitives.js'

const finiteNumberSchema = z.number().finite()

export const propertyToleranceSchema = z
  .object({
    mode: z.literal('property'),
    expected: measuredValueSchema,
    allowedError: measuredValueSchema,
  })
  .strict()

export const verificationToleranceSchema = z.union([toleranceSchema, propertyToleranceSchema])

const absoluteErrorSchema = z
  .object({
    mode: z.literal('absolute'),
    value: finiteNumberSchema.nonnegative(),
    unit: z.string().trim().min(1).max(24),
  })
  .strict()

const relativeErrorSchema = z
  .object({
    mode: z.literal('relative'),
    value: finiteNumberSchema.nonnegative(),
  })
  .strict()

const inputsSchema = z
  .record(fieldIdentifierSchema, measuredValueSchema)
  .refine((inputs) => Object.keys(inputs).length > 0 && Object.keys(inputs).length <= 16, {
    message: 'A finding must contain between one and sixteen inputs.',
  })

export const verificationFindingSchema = z
  .object({
    id: identifierSchema,
    category: z.enum(['mismatch', 'invariant', 'applicability']),
    severity: z.enum(['error', 'warning', 'info']),
    checkId: identifierSchema,
    quantity: fieldIdentifierSchema,
    inputs: inputsSchema,
    expected: measuredValueSchema,
    actual: measuredValueSchema,
    tolerance: verificationToleranceSchema,
    error: z.discriminatedUnion('mode', [absoluteErrorSchema, relativeErrorSchema]),
    explanation: z.string().trim().min(1).max(1_000),
  })
  .strict()

export type PropertyTolerance = z.infer<typeof propertyToleranceSchema>
export type VerificationTolerance = z.infer<typeof verificationToleranceSchema>
export type VerificationFinding = z.infer<typeof verificationFindingSchema>
