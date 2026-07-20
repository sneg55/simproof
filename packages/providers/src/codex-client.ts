import { Codex } from '@openai/codex-sdk'

export interface CodexTurn {
  readonly items: readonly {
    readonly id: string
    readonly type: string
    readonly changes?: readonly { readonly path: string }[]
  }[]
  readonly finalResponse: string
  readonly usage: {
    readonly input_tokens: number
    readonly output_tokens: number
  } | null
}

export interface CodexThread {
  readonly id: string | null
  run(prompt: string, options: { readonly signal?: AbortSignal }): Promise<CodexTurn>
}

export interface CodexThreadOptions {
  readonly additionalDirectories: string[]
  readonly approvalPolicy: 'never'
  readonly model: string
  readonly networkAccessEnabled: false
  // Codex's own workspace-write sandbox uses bubblewrap, which cannot create a
  // user namespace inside our container (nested unprivileged sandboxing is
  // blocked), so every artifact write failed. The container itself is the
  // isolation boundary: an ephemeral per-run workspace, generated artifacts
  // validated (exact inventory, no symlinks, size/JSON/manifest checks) before
  // use, and execution confined to the sealed no-network verification runner.
  readonly sandboxMode: 'danger-full-access'
  readonly skipGitRepoCheck: true
  readonly webSearchMode: 'disabled'
  readonly workingDirectory: string
}

export interface CodexClient {
  startThread(options: CodexThreadOptions): CodexThread
  resumeThread(id: string, options: CodexThreadOptions): CodexThread
}

export interface CodexClientFactory {
  create(environment: Readonly<Record<string, string>>): CodexClient
}

class SdkCodexClientFactory implements CodexClientFactory {
  readonly #apiKey: string

  constructor(apiKey: string) {
    this.#apiKey = apiKey
  }

  create(environment: Readonly<Record<string, string>>): CodexClient {
    return new Codex({ apiKey: this.#apiKey, env: { ...environment } })
  }
}

export const createSdkCodexClientFactory = (apiKey: string): CodexClientFactory =>
  new SdkCodexClientFactory(apiKey)
