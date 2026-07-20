import { z } from 'zod'

const correlationFields = {
  requestId: z.uuid().optional(),
  runId: z.uuid().optional(),
  attemptId: z.uuid().optional(),
  simulationId: z.uuid().optional(),
} as const

export const correlationSchema = z
  .object(correlationFields)
  .strict()
  .superRefine(({ attemptId, requestId, runId, simulationId }, context) => {
    if (
      requestId !== undefined ||
      runId !== undefined ||
      attemptId !== undefined ||
      simulationId !== undefined
    ) {
      if (attemptId !== undefined && runId === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['runId'],
          message: 'Attempt correlation requires its owning run identifier.',
        })
      }
      return
    }
    context.addIssue({
      code: 'custom',
      message: 'At least one correlation identifier is required.',
    })
  })

export type Correlation = z.infer<typeof correlationSchema>
