import { isAbsolute, relative, resolve, sep } from 'node:path'

import { runnerImageDigestSchema } from '@simproof/contracts'

import type { ParsedEnvironment } from './environment-schema.js'

export interface ProviderPricing {
  readonly inputMicrousdPerMillion: number
  readonly outputMicrousdPerMillion: number
}

export interface GenerationConfiguration {
  readonly openaiModel: string
  readonly codexModel: string
  readonly openaiPricing: ProviderPricing
  readonly codexPricing: ProviderPricing
  readonly codexWorkspaceRoot: string
  readonly codexStateRoot: string
}

export interface RunnerConfiguration {
  readonly endpoint: string
  readonly token: string
  readonly image: string
  readonly version: string
}

interface StorageRoots {
  readonly artifactRoot: string
  readonly databasePath: string
  readonly diagnosticLogRoot: string
}

export function validateGenerationConfiguration(
  value: ParsedEnvironment,
  storage: StorageRoots,
): {
  readonly config: GenerationConfiguration | undefined
  readonly runner: RunnerConfiguration | undefined
  readonly invalidFields: readonly string[]
} {
  const providers = providerEntries(value)
  const runners = runnerEntries(value)
  const providerConfigured = providers.some(([, entry]) => entry !== undefined)
  const runnerConfigured = runners.some(([, entry]) => entry !== undefined)
  if (!providerConfigured && !runnerConfigured) {
    return { config: undefined, runner: undefined, invalidFields: [] }
  }
  const invalidFields = [
    ...(providerConfigured
      ? providers.flatMap(([field, entry]) => (entry === undefined ? [field] : []))
      : []),
    ...(runnerConfigured || providerConfigured
      ? runners.flatMap(([field, entry]) => (entry === undefined ? [field] : []))
      : []),
  ] as string[]
  validateRunner(value, invalidFields)
  validateCodexRoots(value, storage, invalidFields)
  if (providerConfigured && generationReservationCost(value) > 5_000_000) {
    invalidFields.push(
      'SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION',
      'SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION',
      'SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION',
      'SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION',
    )
  }
  if (invalidFields.length > 0) {
    return { config: undefined, runner: undefined, invalidFields }
  }
  const runner = runnerConfigured ? runnerConfiguration(value) : undefined
  return {
    config: providerConfigured ? providerConfiguration(value) : undefined,
    runner,
    invalidFields,
  }
}

function providerEntries(value: ParsedEnvironment) {
  return [
    ['OPENAI_API_KEY', value.OPENAI_API_KEY],
    ['CODEX_API_KEY', value.CODEX_API_KEY],
    ['SIMPROOF_OPENAI_MODEL', value.SIMPROOF_OPENAI_MODEL],
    ['SIMPROOF_CODEX_MODEL', value.SIMPROOF_CODEX_MODEL],
    [
      'SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION',
      value.SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION,
    ],
    [
      'SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION',
      value.SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION,
    ],
    [
      'SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION',
      value.SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION,
    ],
    [
      'SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION',
      value.SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION,
    ],
    ['SIMPROOF_CODEX_WORKSPACE_ROOT', value.SIMPROOF_CODEX_WORKSPACE_ROOT],
    ['SIMPROOF_CODEX_STATE_ROOT', value.SIMPROOF_CODEX_STATE_ROOT],
  ] as const
}

function runnerEntries(value: ParsedEnvironment) {
  return [
    ['SIMPROOF_RUNNER_ENDPOINT', value.SIMPROOF_RUNNER_ENDPOINT],
    ['SIMPROOF_RUNNER_TOKEN', value.SIMPROOF_RUNNER_TOKEN],
    ['SIMPROOF_RUNNER_IMAGE', value.SIMPROOF_RUNNER_IMAGE],
    ['SIMPROOF_RUNNER_VERSION', value.SIMPROOF_RUNNER_VERSION],
  ] as const
}

function validateRunner(value: ParsedEnvironment, invalid: string[]): void {
  if (
    value.SIMPROOF_RUNNER_ENDPOINT !== undefined &&
    !validRunnerEndpoint(value.SIMPROOF_RUNNER_ENDPOINT)
  ) {
    invalid.push('SIMPROOF_RUNNER_ENDPOINT')
  }
  if (
    value.SIMPROOF_RUNNER_IMAGE !== undefined &&
    !runnerImageDigestSchema.safeParse(value.SIMPROOF_RUNNER_IMAGE).success
  ) {
    invalid.push('SIMPROOF_RUNNER_IMAGE')
  }
}

function validateCodexRoots(
  value: ParsedEnvironment,
  storage: StorageRoots,
  invalid: string[],
): void {
  for (const [field, root] of [
    ['SIMPROOF_CODEX_WORKSPACE_ROOT', value.SIMPROOF_CODEX_WORKSPACE_ROOT],
    ['SIMPROOF_CODEX_STATE_ROOT', value.SIMPROOF_CODEX_STATE_ROOT],
  ] as const) {
    if (
      root !== undefined &&
      (!isAbsolute(root) ||
        pathsOverlap(root, process.cwd()) ||
        pathsOverlap(root, storage.databasePath) ||
        pathsOverlap(root, storage.artifactRoot) ||
        pathsOverlap(root, storage.diagnosticLogRoot))
    ) {
      invalid.push(field)
    }
  }
  if (
    value.SIMPROOF_CODEX_WORKSPACE_ROOT !== undefined &&
    value.SIMPROOF_CODEX_STATE_ROOT !== undefined &&
    pathsOverlap(value.SIMPROOF_CODEX_WORKSPACE_ROOT, value.SIMPROOF_CODEX_STATE_ROOT)
  ) {
    invalid.push('SIMPROOF_CODEX_STATE_ROOT')
  }
}

function providerConfiguration(value: ParsedEnvironment): GenerationConfiguration {
  return {
    openaiModel: value.SIMPROOF_OPENAI_MODEL as string,
    codexModel: value.SIMPROOF_CODEX_MODEL as string,
    openaiPricing: {
      inputMicrousdPerMillion: value.SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION as number,
      outputMicrousdPerMillion: value.SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION as number,
    },
    codexPricing: {
      inputMicrousdPerMillion: value.SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION as number,
      outputMicrousdPerMillion: value.SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION as number,
    },
    codexWorkspaceRoot: resolve(value.SIMPROOF_CODEX_WORKSPACE_ROOT as string),
    codexStateRoot: resolve(value.SIMPROOF_CODEX_STATE_ROOT as string),
  }
}

function runnerConfiguration(value: ParsedEnvironment): RunnerConfiguration {
  return {
    endpoint: value.SIMPROOF_RUNNER_ENDPOINT as string,
    token: value.SIMPROOF_RUNNER_TOKEN as string,
    image: value.SIMPROOF_RUNNER_IMAGE as string,
    version: value.SIMPROOF_RUNNER_VERSION as string,
  }
}

function generationReservationCost(value: ParsedEnvironment): number {
  const prices = [
    value.SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION,
    value.SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION,
    value.SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION,
    value.SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION,
  ]
  if (prices.some((price) => price === undefined)) return 0
  return Math.ceil(
    (12_000 * (prices[0] as number) +
      3_000 * (prices[1] as number) +
      96_000 * (prices[2] as number) +
      24_000 * (prices[3] as number)) /
      1_000_000,
  )
}

function validRunnerEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      url.hostname === 'runner-launcher' &&
      url.port === '4318' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return contains(resolvedLeft, resolvedRight) || contains(resolvedRight, resolvedLeft)
}

function contains(parent: string, candidate: string): boolean {
  const nested = relative(parent, candidate)
  return nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))
}
