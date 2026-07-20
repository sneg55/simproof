import { z } from 'zod'

const timestampSchema = z.iso.datetime({ offset: true })

function passwordSchema(minimumBytes: number) {
  return z
    .string()
    .refine((value) => !value.includes('\0'))
    .refine((value) => {
      const bytes = new TextEncoder().encode(value).byteLength
      return bytes >= minimumBytes && bytes <= 1_024
    })
}

export const passwordInputSchema = passwordSchema(1)
export const newPasswordInputSchema = passwordSchema(12)

export const sessionTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u)
export const csrfTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u)

export const loginRequestSchema = z.object({ password: passwordInputSchema }).strict()

export const adminBootstrapRequestSchema = z
  .object({
    bootstrapSecret: z.string().min(32).max(1_024),
    newPassword: newPasswordInputSchema,
  })
  .strict()

export const sessionRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    administratorId: z.literal(1),
    tokenHash: z
      .string()
      .length(64)
      .regex(/^[a-f\d]+$/u),
    csrfHash: z
      .string()
      .length(64)
      .regex(/^[a-f\d]+$/u),
    credentialVersion: z.number().int().positive(),
    createdAt: timestampSchema,
    lastActivityAt: timestampSchema,
    expiresAt: timestampSchema,
    rotatedFromId: z.string().min(1).max(128).nullable(),
    revokedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((session, context) => {
    const created = Date.parse(session.createdAt)
    const lastActivity = Date.parse(session.lastActivityAt)
    const expires = Date.parse(session.expiresAt)
    if (expires <= created) {
      context.addIssue({ code: 'custom', message: 'Session timestamps are inconsistent.' })
    }
    if (lastActivity < created || lastActivity >= expires) {
      context.addIssue({ code: 'custom', message: 'Session activity is inconsistent.' })
    }
    if (session.revokedAt !== null && Date.parse(session.revokedAt) < created) {
      context.addIssue({ code: 'custom', message: 'Session revocation precedes creation.' })
    }
  })

export const logoutRequestSchema = z.object({ csrfToken: csrfTokenSchema }).strict()

export const stateChangingRequestSchema = z
  .object({
    requestId: z.uuid(),
    origin: z.url().max(2_048),
    contentType: z.literal('application/json'),
    contentLength: z.number().int().nonnegative().max(1_048_576),
    csrfToken: csrfTokenSchema,
  })
  .strict()

export type LoginRequest = z.infer<typeof loginRequestSchema>
export type AdminBootstrapRequest = z.infer<typeof adminBootstrapRequestSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type StateChangingRequest = z.infer<typeof stateChangingRequestSchema>
