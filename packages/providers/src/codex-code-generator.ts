import { type ProviderProvenance, providerProvenanceSchema } from '@simproof/contracts'

import { prepareArtifactWorkspace, validatedTurnArtifacts } from './codex-artifacts.js'
import {
  type CodexClientFactory,
  type CodexThreadOptions,
  createSdkCodexClientFactory,
} from './codex-client.js'
import {
  type CodexOperation,
  type CodexTurnContext,
  finalizeLeases,
  promptForOperation,
  stateForOperation,
  threadForOperation,
} from './codex-operation.js'
import { type CodexStateStore, FilesystemCodexStateStore } from './codex-state.js'
import {
  type CodexWorkspaceFactory,
  disposeCodexWorkspace,
  FilesystemCodexWorkspaceFactory,
} from './codex-workspace.js'
import { classifyProviderException, providerErrors, providerFailure } from './errors.js'
import {
  createProviderCallReservation,
  estimatedCostMicrousd,
  failedCallUsage,
  type ProviderMeteringPolicyConfig,
} from './metering-policy.js'
import {
  type CodeGenerationRequest,
  type CodeGenerationResult,
  type CodeGenerator,
  type CodeRepairRequest,
  GENERATED_ARTIFACT_PATHS,
  type ProviderCallMetering,
  type ProviderCallOptions,
  type ProviderCallReservation,
  type ProviderDescriptor,
  type ProviderResult,
} from './types.js'

export const ALLOWED_CODEX_ARTIFACT_PATHS = GENERATED_ARTIFACT_PATHS

export interface CodexCodeGeneratorConfig extends ProviderMeteringPolicyConfig {
  readonly apiKey: string
  readonly model: string
  readonly templateVersion: string
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly environment?: Readonly<Record<string, string>>
  readonly forbiddenWorkspaceRoots?: readonly string[]
  readonly forbiddenStateRoots?: readonly string[]
  readonly generateReservation: ProviderCallReservation
  readonly repairReservation: ProviderCallReservation
}

export interface CodexCodeGeneratorDependencies {
  readonly clientFactory?: CodexClientFactory
  readonly stateStore?: CodexStateStore
  readonly workspaceFactory?: CodexWorkspaceFactory
}

export const createCodexEnvironment = (
  input: Readonly<Record<string, string>>,
  temporaryPath: string,
  statePath: string,
) => {
  const output: Record<string, string> = {
    CODEX_HOME: statePath,
    HOME: statePath,
    TMPDIR: temporaryPath,
  }
  const { NODE_EXTRA_CA_CERTS, PATH, SSL_CERT_FILE } = input
  if (NODE_EXTRA_CA_CERTS !== undefined) output.NODE_EXTRA_CA_CERTS = NODE_EXTRA_CA_CERTS
  if (PATH !== undefined) output.PATH = PATH
  if (SSL_CERT_FILE !== undefined) output.SSL_CERT_FILE = SSL_CERT_FILE
  return output
}

const threadOptions = (model: string, workingDirectory: string): CodexThreadOptions => ({
  additionalDirectories: [],
  approvalPolicy: 'never',
  model,
  networkAccessEnabled: false,
  sandboxMode: 'danger-full-access',
  skipGitRepoCheck: true,
  webSearchMode: 'disabled',
  workingDirectory,
})

const emptyUsage = { inputTokens: 0, outputTokens: 0, requestCount: 0, costMicrousd: 0 }
const ARTIFACT_SCOPE = 'artifact-scope'

export class CodexCodeGenerator implements CodeGenerator {
  readonly descriptor: ProviderDescriptor
  readonly generateReservation: ProviderCallReservation
  readonly repairReservation: ProviderCallReservation
  readonly #config: CodexCodeGeneratorConfig
  readonly #clientFactory: CodexClientFactory
  readonly #stateStore: CodexStateStore
  readonly #workspaceFactory: CodexWorkspaceFactory

  constructor(config: CodexCodeGeneratorConfig, dependencies: CodexCodeGeneratorDependencies = {}) {
    this.#config = config
    this.generateReservation = createProviderCallReservation(config.generateReservation)
    this.repairReservation = createProviderCallReservation(config.repairReservation)
    this.descriptor = Object.freeze({
      provider: 'codex-sdk' as const,
      model: config.model,
      templateVersion: config.templateVersion,
    })
    this.#clientFactory = dependencies.clientFactory ?? createSdkCodexClientFactory(config.apiKey)
    this.#stateStore =
      dependencies.stateStore ??
      new FilesystemCodexStateStore(
        config.stateRoot,
        config.forbiddenStateRoots ?? config.forbiddenWorkspaceRoots,
      )
    this.#workspaceFactory =
      dependencies.workspaceFactory ??
      new FilesystemCodexWorkspaceFactory(config.workspaceRoot, config.forbiddenWorkspaceRoots)
  }

  generate(request: CodeGenerationRequest, options?: ProviderCallOptions) {
    return this.#execute({ kind: 'generate', request }, options)
  }

  repair(request: CodeRepairRequest, options?: ProviderCallOptions) {
    return this.#execute({ kind: 'repair', request }, options)
  }

  disposeThread(threadId: string) {
    return this.#stateStore.disposeThread(threadId)
  }

  disposeOrphanedState(retainedThreadIds: readonly string[] = []) {
    return this.#stateStore.disposeOrphanedState(retainedThreadIds)
  }

  async #execute(
    operation: CodexOperation,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<CodeGenerationResult>> {
    const unmetered = this.#metering([], emptyUsage)
    if (options?.signal?.aborted === true) {
      return providerFailure(providerErrors.cancellation, 'cancellation', unmetered)
    }
    const workspace = await this.#workspaceFactory.create()
    if (!workspace.ok) return providerFailure(providerErrors.invariant, ARTIFACT_SCOPE, unmetered)
    const state = await stateForOperation(operation, this.#stateStore)
    if (!state.ok) {
      await disposeCodexWorkspace(workspace.value)
      return providerFailure(providerErrors.invariant, ARTIFACT_SCOPE, unmetered)
    }

    const previousArtifacts =
      operation.kind === 'repair' ? operation.request.previousArtifacts : undefined
    const prepared = await prepareArtifactWorkspace(workspace.value.path, previousArtifacts)

    let outcome: ProviderResult<CodeGenerationResult> = providerFailure(
      providerErrors.invariant,
      ARTIFACT_SCOPE,
      unmetered,
    )
    if (prepared) {
      try {
        outcome = await this.#runTurn(operation, {
          workspacePath: workspace.value.path,
          temporaryPath: workspace.value.temporaryPath,
          statePath: state.value.path,
          ...(options === undefined ? {} : { options }),
        })
      } catch (error) {
        outcome = classifyProviderException(error, this.#metering([], emptyUsage), options?.signal)
      }
    }
    if (await finalizeLeases(workspace.value, state.value, outcome)) return outcome
    const metering = outcome.ok
      ? {
          provider: outcome.value.provenance.provider,
          model: outcome.value.provenance.model,
          templateVersion: outcome.value.provenance.templateVersion,
          requestIds: outcome.value.provenance.requestIds,
          usage: outcome.value.provenance.usage,
        }
      : outcome.metering
    return providerFailure(providerErrors.invariant, ARTIFACT_SCOPE, metering)
  }

  async #runTurn(
    operation: CodexOperation,
    context: CodexTurnContext,
  ): Promise<ProviderResult<CodeGenerationResult>> {
    const environment = createCodexEnvironment(
      this.#config.environment ?? {},
      context.temporaryPath,
      context.statePath,
    )
    const client = this.#clientFactory.create(environment)
    const settings = threadOptions(this.#config.model, context.workspacePath)
    const thread = threadForOperation(operation, client, settings)
    if (thread === undefined) {
      return providerFailure(
        providerErrors.invariant,
        'provider-response',
        this.#metering([], emptyUsage),
      )
    }
    let turn
    try {
      turn = await thread.run(promptForOperation(operation), {
        ...(context.options?.signal === undefined ? {} : { signal: context.options.signal }),
      })
    } catch (error) {
      const reserved = failedCallUsage(this.#config)
      return classifyProviderException(
        error,
        this.#metering([], { ...reserved, requestCount: 1 }),
        context.options?.signal,
      )
    }
    const tokenUsage = {
      inputTokens: turn.usage?.input_tokens ?? 0,
      outputTokens: turn.usage?.output_tokens ?? 0,
    }
    const usage = {
      ...tokenUsage,
      requestCount: 1,
      costMicrousd: estimatedCostMicrousd(this.#config, tokenUsage),
    }
    const metering = this.#metering([], usage)
    const artifacts = await validatedTurnArtifacts(
      context.workspacePath,
      turn,
      operation.request.conceptSpec.domain,
    )
    const threadId = thread.id
    if (artifacts === undefined || threadId === null) {
      return providerFailure(providerErrors.invariant, ARTIFACT_SCOPE, metering)
    }
    const provenance: ProviderProvenance = {
      provider: 'codex-sdk',
      model: this.#config.model,
      templateVersion: this.#config.templateVersion,
      requestIds: [],
      threadId,
      usage,
    }
    const parsedProvenance = providerProvenanceSchema.safeParse(provenance)
    return parsedProvenance.success
      ? {
          ok: true,
          value: { artifacts, threadId, provenance: parsedProvenance.data },
        }
      : providerFailure(providerErrors.malformed, 'provider-response', metering)
  }

  #metering(
    requestIds: readonly string[],
    usage: ProviderCallMetering['usage'],
  ): ProviderCallMetering {
    return {
      provider: 'codex-sdk',
      model: this.#config.model,
      templateVersion: this.#config.templateVersion,
      requestIds,
      usage,
    }
  }
}
