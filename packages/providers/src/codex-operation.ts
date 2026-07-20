import type { CodexClient, CodexThread, CodexThreadOptions } from './codex-client.js'
import type { CodexStateLease, CodexStateResult, CodexStateStore } from './codex-state.js'
import { type CodexWorkspaceLease, disposeCodexWorkspace } from './codex-workspace.js'
import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodeRepairRequest,
  ProviderCallOptions,
  ProviderResult,
} from './types.js'

export type CodexOperation =
  | { readonly kind: 'generate'; readonly request: CodeGenerationRequest }
  | { readonly kind: 'repair'; readonly request: CodeRepairRequest }

export interface CodexTurnContext {
  readonly statePath: string
  readonly temporaryPath: string
  readonly workspacePath: string
  readonly options?: ProviderCallOptions
}

// The sealed verifier accepts only the trusted physics model for each domain
// (small-angle pendulum period; ideal projectile), so core.mjs must reproduce
// these formulas, the exact per-domain gravity, and the exact observation field
// names, or the run is rejected. These match the verifier reference models:
// pendulum EARTH_GRAVITY_MPS2 = 9.80665, projectile PROJECTILE_GRAVITY_MPS2 = 9.81.
const pendulumCore = `export default Object.freeze({
  protocolVersion: '1',
  sample(input) {
    const lengthM = input.lengthM
    const amplitudeDeg = input.amplitudeDeg
    return Object.freeze({
      input: Object.freeze({ lengthM, amplitudeDeg }),
      periodS: 2 * Math.PI * Math.sqrt(lengthM / 9.80665),
    })
  },
})`

const projectileCore = `const G = 9.81
export default Object.freeze({
  protocolVersion: '1',
  sample(input) {
    const angleRad = (input.launchAngleDeg * Math.PI) / 180
    const horizontalSpeedMps = input.initialSpeedMps * Math.cos(angleRad)
    const initialVerticalSpeedMps = input.initialSpeedMps * Math.sin(angleRad)
    const flightTimeS = (2 * initialVerticalSpeedMps) / G
    const sampleCount = 5
    const trajectory = Array.from({ length: sampleCount }, (unused, index) => {
      const timeS = (flightTimeS * index) / (sampleCount - 1)
      const verticalSpeedMps = initialVerticalSpeedMps - G * timeS
      return Object.freeze({
        timeS,
        xM: horizontalSpeedMps * timeS,
        yM: initialVerticalSpeedMps * timeS - 0.5 * G * timeS * timeS,
        speedMps: Math.hypot(horizontalSpeedMps, verticalSpeedMps),
      })
    })
    return Object.freeze({
      input: Object.freeze({
        initialSpeedMps: input.initialSpeedMps,
        launchAngleDeg: input.launchAngleDeg,
      }),
      summary: Object.freeze({
        rangeM: horizontalSpeedMps * flightTimeS,
        apexHeightM: (initialVerticalSpeedMps * initialVerticalSpeedMps) / (2 * G),
        flightTimeS,
        initialSpeedMps: input.initialSpeedMps,
      }),
      trajectory,
    })
  },
})`

const coreForDomain = (domain: 'projectile' | 'pendulum') =>
  domain === 'pendulum' ? pendulumCore : projectileCore

const artifactContract = (
  domain: 'projectile' | 'pendulum',
) => `Write these four files, and no others, into the working directory. Each must match the required contents EXACTLY (do not add, rename, or reorder fields):

manifest.json (write verbatim):
{"schemaVersion":"1","domain":"${domain}","core":"core.mjs","renderer":"renderer.json","testAdapter":"test-adapter.json"}

core.mjs (an ES module; the trusted verifier checks this physics, so write it verbatim):
${coreForDomain(domain)}

renderer.json (a JSON object):
{"schemaVersion":"1","kind":"${domain}","representation":"svg"}

test-adapter.json (a JSON object):
{"schemaVersion":"1","domain":"${domain}"}`

const generationPrompt = (
  request: CodeGenerationRequest,
) => `Create four files in the working directory by writing each one to disk with a single apply_patch, using the EXACT contents below. Do not run any other shell commands, do not read the files back to check them, and do not create any other files. Once the four files are written you are done: stop immediately without further steps.

${artifactContract(request.conceptSpec.domain)}

ConceptSpec (context for the title and parameter ranges only; do not change the physics, field names, or file contents above):
${JSON.stringify(request.conceptSpec)}`

const repairPrompt = (
  request: CodeRepairRequest,
) => `Rewrite the four files to disk with a single apply_patch each, using the EXACT contents below. Do not run any other shell commands, do not read the files back, and do not create any other files. Once the four files are written you are done: stop immediately.

${artifactContract(request.conceptSpec.domain)}

Bounded verification evidence (for context only; the contents above are already correct):
${JSON.stringify({ findings: request.findings.slice(0, 20), diagnostics: request.diagnostics.slice(0, 20) })}`

export const threadForOperation = (
  operation: CodexOperation,
  client: CodexClient,
  settings: CodexThreadOptions,
): CodexThread | undefined => {
  if (operation.kind === 'generate') return client.startThread(settings)
  const threadId = operation.request.threadId
  return threadId === null ? undefined : client.resumeThread(threadId, settings)
}

export const promptForOperation = (operation: CodexOperation) =>
  operation.kind === 'repair'
    ? repairPrompt(operation.request)
    : generationPrompt(operation.request)

export const stateForOperation = async (
  operation: CodexOperation,
  store: CodexStateStore,
): Promise<CodexStateResult> => {
  if (operation.kind === 'generate') return await store.begin()
  const threadId = operation.request.threadId
  return threadId === null ? { ok: false } : await store.resume(threadId)
}

export const finalizeLeases = async (
  workspace: CodexWorkspaceLease,
  state: CodexStateLease,
  outcome: ProviderResult<CodeGenerationResult>,
) => {
  const disposed = await disposeCodexWorkspace(workspace)
  if (!outcome.ok || !disposed) {
    const discarded = await state.discard()
    return disposed && discarded
  }
  const adopted = await state.adopt(outcome.value.threadId ?? '')
  if (adopted) return true
  await state.discard()
  return false
}
