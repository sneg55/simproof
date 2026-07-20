import {
  identifierSchema,
  type LibraryQuery,
  libraryQuerySchema,
  portableSimulationExportSchema,
  seedMetadataSchema,
  simulationExportCommandSchema,
} from '@simproof/contracts'
import { z } from 'zod'

import { type FailureDiagnostic, operationDiagnostic } from './failure-diagnostic.js'
import { failure, success } from './response.js'
import type { RouteDefinition, RouteKey } from './routes.js'
import type {
  EducatorHttpCallbacks,
  HttpOperationFailureCode,
  HttpOperationResult,
  HttpResponse,
} from './types.js'

const recordIdSchema = z.uuid()

export interface EducatorDispatchContext {
  readonly route: RouteDefinition
  readonly parameters: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly body: unknown
  readonly sessionId: string | undefined
  readonly origin: string | undefined
}

export const seedListSchema = z.array(seedMetadataSchema).max(100)
export const comparisonQuerySchema = z.object({ left: z.uuid(), right: z.uuid() }).strict()
export const educatorRouteKeyValues = [
  'bootstrap-capability',
  'runtime-config',
  'seeds-list',
  'seed-detail',
  'seed-report',
  'seed-preview',
  'simulations-list',
  'simulation-detail',
  'simulation-create',
  'simulation-history',
  'simulation-compare',
  'simulation-version-create',
  'simulation-duplicate',
  'educator-generation-start',
  'educator-generation-status',
  'educator-generation-concept',
  'educator-generation-cancel',
  'version-report',
  'version-publish',
  'version-archive',
  'version-reverify',
  'simulation-export',
  'version-preview',
] as const satisfies readonly RouteKey[]

export type EducatorRouteKey = (typeof educatorRouteKeyValues)[number]
export type LegacyRouteKey = Exclude<RouteKey, EducatorRouteKey>
export type AuthenticatedEducatorRouteKey = Exclude<EducatorRouteKey, 'bootstrap-capability'>
export type EducatorCommandRouteKey = Extract<
  AuthenticatedEducatorRouteKey,
  | 'simulation-create'
  | 'seed-preview'
  | 'simulation-version-create'
  | 'simulation-duplicate'
  | 'educator-generation-start'
  | 'educator-generation-concept'
  | 'educator-generation-cancel'
  | 'version-publish'
  | 'version-archive'
  | 'version-reverify'
  | 'simulation-export'
  | 'version-preview'
>
export type EducatorReadRouteKey = Exclude<AuthenticatedEducatorRouteKey, EducatorCommandRouteKey>
const educatorRouteKeys = new Set<RouteKey>(educatorRouteKeyValues)
const educatorCommandRouteKeys = new Set<EducatorRouteKey>([
  'simulation-create',
  'seed-preview',
  'simulation-version-create',
  'simulation-duplicate',
  'educator-generation-start',
  'educator-generation-concept',
  'educator-generation-cancel',
  'version-publish',
  'version-archive',
  'version-reverify',
  'simulation-export',
  'version-preview',
])

export function isEducatorRouteKey(key: RouteKey): key is EducatorRouteKey {
  return educatorRouteKeys.has(key)
}

export function isEducatorCommandRouteKey(
  key: AuthenticatedEducatorRouteKey,
): key is EducatorCommandRouteKey {
  return educatorCommandRouteKeys.has(key)
}

const listQueryInputSchema = z
  .object({
    cursor: z.string().optional(),
    domain: z.string().optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d{0,2}$/u)
      .optional(),
    search: z.string().optional(),
    source: z.string().optional(),
    state: z.string().optional(),
  })
  .strict()

export function parseLibraryQuery(
  query: Readonly<Record<string, string>>,
): LibraryQuery | undefined {
  const parsed = listQueryInputSchema.safeParse(query)
  if (!parsed.success) return undefined
  const list = (value: string | undefined) => value?.split(',') ?? []
  const candidate = libraryQuerySchema.safeParse({
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
    ...(parsed.data.limit === undefined ? {} : { limit: Number(parsed.data.limit) }),
    domains: list(parsed.data.domain),
    states: list(parsed.data.state),
    sources: list(parsed.data.source),
  })
  return candidate.success ? candidate.data : undefined
}

export function resourceId(candidate: string | undefined): string | undefined {
  const parsed = recordIdSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

export function seedId(candidate: string | undefined): string | undefined {
  const parsed = identifierSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

type Operation = HttpOperationResult<unknown> | Promise<HttpOperationResult<unknown>>

export async function simulationExportResponse(options: {
  readonly callback: EducatorHttpCallbacks['exportSimulation']
  readonly candidate: string | undefined
  readonly body: unknown
  readonly sessionId: string
  readonly origin: string | undefined
}): Promise<HttpResponse> {
  const id = resourceId(options.candidate)
  const parsed = simulationExportCommandSchema.safeParse(options.body)
  if (id === undefined || !parsed.success || parsed.data.simulationId !== id) {
    return invalidEducatorInput(options.origin)
  }
  return educatorResponse(
    portableSimulationExportSchema,
    await options.callback(parsed.data, options.sessionId),
    options.origin,
  )
}

export async function readEducatorResource(options: {
  readonly schema: z.ZodType
  readonly candidate: string | undefined
  readonly invoke: (id: string) => Operation
  readonly origin: string | undefined
  readonly parseId?: (candidate: string | undefined) => string | undefined
}): Promise<HttpResponse> {
  const id = (options.parseId ?? resourceId)(options.candidate)
  return id === undefined
    ? invalidEducatorInput(options.origin)
    : educatorResponse(options.schema, await options.invoke(id), options.origin)
}

export async function educatorBodyResponse<Input>(options: {
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType
  readonly body: unknown
  readonly invoke: (input: Input) => Operation
  readonly origin: string | undefined
  readonly status?: number
}): Promise<HttpResponse> {
  const parsed = options.inputSchema.safeParse(options.body)
  return !parsed.success
    ? invalidEducatorInput(options.origin)
    : educatorResponse(
        options.outputSchema,
        await options.invoke(parsed.data),
        options.origin,
        options.status,
      )
}

export async function educatorResourceBodyResponse<Input>(options: {
  readonly candidate: string | undefined
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType
  readonly body: unknown
  readonly invoke: (id: string, input: Input) => Operation
  readonly origin: string | undefined
  readonly status?: number
  readonly parseId?: (candidate: string | undefined) => string | undefined
}): Promise<HttpResponse> {
  const id = (options.parseId ?? resourceId)(options.candidate)
  return id === undefined
    ? invalidEducatorInput(options.origin)
    : await educatorBodyResponse({
        inputSchema: options.inputSchema,
        outputSchema: options.outputSchema,
        body: options.body,
        invoke: (input) => options.invoke(id, input),
        origin: options.origin,
        ...(options.status === undefined ? {} : { status: options.status }),
      })
}

export function educatorResponse(
  schema: z.ZodType,
  result: HttpOperationResult<unknown>,
  origin: string | undefined,
  status = 200,
): HttpResponse {
  if (!result.ok) return operationFailure(result.error.code, origin, result.error.detail)
  const parsed = schema.safeParse(result.value)
  return parsed.success
    ? success(status, parsed.data, origin)
    : failure(500, 'http.internal-error', origin, {
        detail: 'educator.response-schema-invalid',
        failureClass: 'internal-error',
      })
}

function operationFailure(
  code: HttpOperationFailureCode,
  origin: string | undefined,
  detail: string | undefined,
): HttpResponse {
  const diagnostic = operationDiagnostic(code, detail)
  if (code === 'invalid-input') return invalidEducatorInput(origin, diagnostic)
  if (code === 'not-found') return failure(404, 'http.educator-not-found', origin, diagnostic)
  if (code === 'conflict') return failure(409, 'http.educator-conflict', origin, diagnostic)
  if (code === 'confirmation-failed')
    return failure(403, 'http.password-denied', origin, diagnostic)
  return educatorUnavailable(origin, diagnostic)
}

export const invalidEducatorInput = (
  origin: string | undefined,
  diagnostic?: FailureDiagnostic,
): HttpResponse => failure(400, 'http.invalid-input', origin, diagnostic)

export const educatorUnavailable = (
  origin: string | undefined,
  diagnostic?: FailureDiagnostic,
): HttpResponse => failure(503, 'http.educator-unavailable', origin, diagnostic)
