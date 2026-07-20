// LOC-EXEMPT: The versioned declarative runner protocol is clearest as one auditable boundary schema.
import { z } from 'zod'

import {
  pendulumInputSchema,
  pendulumObservationSchema,
  projectileInputSchema,
  projectileObservationSchema,
} from './observation.js'
import { identifierSchema, semverSchema, sha256Schema } from './primitives.js'

export const RUNNER_PROTOCOL_VERSION = '1' as const
export const MAX_RUNNER_ARTIFACT_BYTES = 262_144
export const MAX_RUNNER_OUTPUT_BYTES = 16_777_216
export const MAX_RUNNER_SAMPLES = 10_000
export const MAX_RUNNER_LAUNCHER_REQUEST_BYTES = 1_048_576

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength

const artifactContentSchema = z
  .string()
  .min(1)
  .max(MAX_RUNNER_ARTIFACT_BYTES)
  .refine((content) => utf8ByteLength(content) <= MAX_RUNNER_ARTIFACT_BYTES, {
    message: `Artifact content must not exceed ${MAX_RUNNER_ARTIFACT_BYTES} UTF-8 bytes.`,
  })

export const runnerArtifactSchema = z
  .object({
    format: z.literal('javascript-esm'),
    content: artifactContentSchema,
    hash: sha256Schema,
  })
  .strict()

export const runnerPolicyReferenceSchema = z
  .object({
    id: identifierSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  })
  .strict()

export const runnerLimitsSchema = z
  .object({
    timeoutMs: z.number().int().min(1).max(30_000),
    memoryBytes: z.number().int().min(16_777_216).max(536_870_912),
    maxOutputBytes: z.number().int().min(1_024).max(MAX_RUNNER_OUTPUT_BYTES),
    maxSamples: z.number().int().min(1).max(MAX_RUNNER_SAMPLES),
  })
  .strict()

const projectileRunnerInputSchema = z
  .object({
    sampleId: identifierSchema,
    input: projectileInputSchema,
  })
  .strict()

const pendulumRunnerInputSchema = z
  .object({
    sampleId: identifierSchema,
    input: pendulumInputSchema,
  })
  .strict()

const runnerRequestFields = {
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  requestId: z.uuid(),
  artifact: runnerArtifactSchema,
  policy: runnerPolicyReferenceSchema,
  limits: runnerLimitsSchema,
}

const uniqueSampleIds = <T extends { sampleId: string }>(samples: T[]) =>
  new Set(samples.map(({ sampleId }) => sampleId)).size === samples.length

const runnerRequestFor = <Domain extends 'projectile' | 'pendulum', Input>(
  domain: Domain,
  inputSchema: z.ZodType<Input>,
) =>
  z
    .object({
      ...runnerRequestFields,
      domain: z.literal(domain),
      inputs: z.array(inputSchema).min(1).max(MAX_RUNNER_SAMPLES),
    })
    .strict()
    .superRefine(({ inputs, limits }, context) => {
      if (!uniqueSampleIds(inputs as { sampleId: string }[])) {
        context.addIssue({ code: 'custom', message: 'Runner sample IDs must be unique.' })
      }
      if (inputs.length > limits.maxSamples) {
        context.addIssue({
          code: 'custom',
          message: 'Runner inputs must not exceed the declared sample limit.',
        })
      }
    })

export const projectileRunnerRequestSchema = runnerRequestFor(
  'projectile',
  projectileRunnerInputSchema,
)
export const pendulumRunnerRequestSchema = runnerRequestFor('pendulum', pendulumRunnerInputSchema)
export const runnerRequestSchema = z.union([
  projectileRunnerRequestSchema,
  pendulumRunnerRequestSchema,
])

export const runnerImageDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'Runner image must be an exact raw lowercase SHA-256 image ID.')

export const runnerLauncherRequestSchema = z
  .object({
    image: runnerImageDigestSchema,
    request: runnerRequestSchema,
  })
  .strict()

export const runnerLauncherErrorIdSchema = z.enum([
  'launcher.authentication-required',
  'launcher.image-denied',
  'launcher.invalid-request',
  'launcher.request-too-large',
  'launcher.unavailable',
])

export const runnerLauncherErrorSchema = z.object({ errorId: runnerLauncherErrorIdSchema }).strict()

export const runnerLauncherCapabilitySchema = z
  .object({
    status: z.literal('ready'),
    protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
    image: runnerImageDigestSchema,
  })
  .strict()

export const runnerPolicyDenialIdSchema = z.enum([
  'runner.denied.forbidden-import',
  'runner.denied.dynamic-import',
  'runner.denied.filesystem-read',
  'runner.denied.filesystem-write',
  'runner.denied.network',
  'runner.denied.subprocess',
  'runner.denied.worker',
  'runner.denied.native-addon',
  'runner.denied.environment',
  'runner.denied.path-traversal',
  'runner.denied.dynamic-code',
  'runner.denied.nondeterminism',
  'runner.denied.output',
  'runner.denied.policy-reference',
])

export const runnerInvalidArtifactIdSchema = z.enum([
  'runner.artifact.hash-mismatch',
  'runner.artifact.oversized',
  'runner.artifact.syntax',
  'runner.artifact.unsupported-protocol',
  'runner.artifact.invalid-entrypoint',
  'runner.artifact.invalid-export',
])

export const runnerResourceLimitIdSchema = z.enum([
  'runner.limit.timeout',
  'runner.limit.memory',
  'runner.limit.output',
  'runner.limit.samples',
  'runner.limit.processes',
])

export const runnerRuntimeErrorIdSchema = z.enum([
  'runner.runtime.crash',
  'runner.runtime.malformed-output',
  'runner.runtime.nondeterministic-output',
])

export const runnerRequestErrorIdSchema = z.enum([
  'runner.request.invalid',
  'runner.artifact.oversized',
  'runner.artifact.unsupported-protocol',
])

export const runnerErrorIdSchema = z.union([
  runnerPolicyDenialIdSchema,
  runnerInvalidArtifactIdSchema,
  runnerResourceLimitIdSchema,
  runnerRuntimeErrorIdSchema,
  z.literal('runner.cancelled'),
  z.literal('runner.internal'),
])

export const runnerExitSchema = z.discriminatedUnion('classification', [
  z.object({ classification: z.literal('success'), errorId: z.null() }).strict(),
  z
    .object({ classification: z.literal('policy-denied'), errorId: runnerPolicyDenialIdSchema })
    .strict(),
  z
    .object({
      classification: z.literal('invalid-artifact'),
      errorId: runnerInvalidArtifactIdSchema,
    })
    .strict(),
  z
    .object({
      classification: z.literal('resource-limit'),
      errorId: runnerResourceLimitIdSchema,
    })
    .strict(),
  z
    .object({ classification: z.literal('runtime-error'), errorId: runnerRuntimeErrorIdSchema })
    .strict(),
  z
    .object({ classification: z.literal('cancelled'), errorId: z.literal('runner.cancelled') })
    .strict(),
  z
    .object({ classification: z.literal('internal-error'), errorId: z.literal('runner.internal') })
    .strict(),
])

export const runnerDiagnosticSchema = z
  .object({
    severity: z.enum(['info', 'warning', 'error']),
    code: identifierSchema,
    message: z.string().trim().min(1).max(2_000),
  })
  .strict()

const projectileRunnerSampleSchema = z
  .object({ sampleId: identifierSchema, observation: projectileObservationSchema })
  .strict()
const pendulumRunnerSampleSchema = z
  .object({ sampleId: identifierSchema, observation: pendulumObservationSchema })
  .strict()

const runnerResponseFields = {
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  requestId: z.uuid(),
  observedArtifactHash: sha256Schema,
  exit: runnerExitSchema,
  diagnostics: z.array(runnerDiagnosticSchema).max(100),
}

const runnerResponseFor = <Domain extends 'projectile' | 'pendulum', Sample>(
  domain: Domain,
  sampleSchema: z.ZodType<Sample>,
) =>
  z
    .object({
      ...runnerResponseFields,
      domain: z.literal(domain),
      samples: z.array(sampleSchema).max(MAX_RUNNER_SAMPLES),
    })
    .strict()
    .superRefine(({ diagnostics, exit, samples }, context) => {
      if (exit.classification === 'success' && samples.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Successful runner responses require samples.',
        })
      }
      if (exit.classification !== 'success' && samples.length !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'Failed runner responses must discard partial samples.',
        })
      }
      if (!uniqueSampleIds(samples as { sampleId: string }[])) {
        context.addIssue({ code: 'custom', message: 'Runner sample IDs must be unique.' })
      }
      if (
        exit.classification === 'success' &&
        diagnostics.some(({ severity }) => severity === 'error')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Successful runner responses must not contain error diagnostics.',
        })
      }
      if (
        exit.classification !== 'success' &&
        !diagnostics.some(({ code, severity }) => code === exit.errorId && severity === 'error')
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Failed runner responses require an error diagnostic matching the exit error ID.',
        })
      }
    })

export const projectileRunnerResponseSchema = runnerResponseFor(
  'projectile',
  projectileRunnerSampleSchema,
)
export const pendulumRunnerResponseSchema = runnerResponseFor(
  'pendulum',
  pendulumRunnerSampleSchema,
)
export const runnerResponseSchema = z.union([
  projectileRunnerResponseSchema,
  pendulumRunnerResponseSchema,
])

export type RunnerArtifact = z.infer<typeof runnerArtifactSchema>
export type RunnerPolicyReference = z.infer<typeof runnerPolicyReferenceSchema>
export type RunnerLimits = z.infer<typeof runnerLimitsSchema>
export type RunnerRequest = z.infer<typeof runnerRequestSchema>
export type RunnerImageDigest = z.infer<typeof runnerImageDigestSchema>
export type RunnerLauncherRequest = z.infer<typeof runnerLauncherRequestSchema>
export type RunnerLauncherErrorId = z.infer<typeof runnerLauncherErrorIdSchema>
export type RunnerLauncherCapability = z.infer<typeof runnerLauncherCapabilitySchema>
export type RunnerErrorId = z.infer<typeof runnerErrorIdSchema>
export type RunnerRequestErrorId = z.infer<typeof runnerRequestErrorIdSchema>
export type RunnerExit = z.infer<typeof runnerExitSchema>
export type RunnerDiagnostic = z.infer<typeof runnerDiagnosticSchema>
export type RunnerResponse = z.infer<typeof runnerResponseSchema>
