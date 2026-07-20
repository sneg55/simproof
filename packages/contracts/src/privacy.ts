import { z } from 'zod'

import { portableSimulationExportSchema } from './export.js'

const timestampSchema = z.iso.datetime({ offset: true })

export const promptRetentionSchema = z.enum(['discard', 'persist'])

export const privacySettingsSchema = z
  .object({
    promptRetention: promptRetentionSchema.default('discard'),
    telemetryEnabled: z.boolean().default(false),
    externalDiagnosticsEnabled: z.boolean().default(false),
  })
  .strict()

export const privacySettingsUpdateRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    promptRetention: promptRetentionSchema,
    externalDiagnosticsEnabled: z.boolean(),
  })
  .strict()

export const teacherGenerationRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(16_384),
    externalProviderDisclosureAccepted: z.literal(true),
    promptRetention: promptRetentionSchema,
  })
  .strict()

export const simulationExportRequestSchema = z.object({ simulationId: z.uuid() }).strict()

export const simulationDeletionRequestSchema = z
  .object({ simulationId: z.uuid(), confirmation: z.literal('delete') })
  .strict()

export const deploymentModeSchema = z.enum(['loopback', 'network'])
export const MIN_REQUEST_BODY_BYTES = 16_384

export const publicRuntimeConfigSchema = z
  .object({
    deploymentMode: deploymentModeSchema,
    providerConfigured: z.boolean(),
    maxRequestBytes: z.number().int().min(MIN_REQUEST_BODY_BYTES).max(1_048_576),
    maxPromptCharacters: z.number().int().min(256).max(65_536),
    promptRetentionDefault: promptRetentionSchema,
    telemetryEnabled: z.boolean(),
    externalDiagnosticsEnabled: z.boolean(),
  })
  .strict()

export const persistedPrivacySettingsSchema = z
  .object({
    promptRetentionEnabled: z.boolean(),
    externalDiagnosticsEnabled: z.boolean(),
    telemetryEnabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict()

export const retainedPromptSchema = z
  .object({
    id: z.uuid(),
    simulationId: z.uuid(),
    prompt: z.string().min(1).max(65_536),
    createdAt: timestampSchema,
  })
  .strict()

export const teacherPrivacyExportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    exportedAt: timestampSchema,
    privacySettings: persistedPrivacySettingsSchema,
    retainedPrompts: z.array(retainedPromptSchema).max(100_000),
    simulations: z.array(portableSimulationExportSchema).max(100_000),
  })
  .strict()

export type PrivacySettings = z.infer<typeof privacySettingsSchema>
export type PrivacySettingsUpdateRequest = z.infer<typeof privacySettingsUpdateRequestSchema>
export type TeacherGenerationRequest = z.infer<typeof teacherGenerationRequestSchema>
export type SimulationExportRequest = z.infer<typeof simulationExportRequestSchema>
export type SimulationDeletionRequest = z.infer<typeof simulationDeletionRequestSchema>
export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>
export type PersistedPrivacySettings = z.infer<typeof persistedPrivacySettingsSchema>
export type RetainedPrompt = z.infer<typeof retainedPromptSchema>
export type TeacherPrivacyExport = z.infer<typeof teacherPrivacyExportSchema>
