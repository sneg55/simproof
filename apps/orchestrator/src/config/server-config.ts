import type { GenerationConfiguration, RunnerConfiguration } from './generation-environment.js'

export interface ServerConfig {
  readonly environment: 'development' | 'test' | 'production'
  readonly deploymentMode: 'loopback' | 'network'
  readonly server?: {
    readonly host: '127.0.0.1' | '0.0.0.0'
    readonly port: number
  }
  readonly databasePath: string
  readonly artifactRoot: string
  readonly allowedOrigins: readonly string[]
  readonly trustedProxyAddress: string | undefined
  readonly adminBootstrapSecret: string | undefined
  readonly sessionSecret: string | undefined
  readonly localAuthBypass: boolean
  readonly providers: {
    readonly openaiApiKey: string | undefined
    readonly codexApiKey: string | undefined
  }
  readonly runner?: RunnerConfiguration | undefined
  readonly generation?: GenerationConfiguration
  /**
   * True only when demo generation was explicitly requested and no real provider
   * is configured. Never a fallback for a failing real provider, and never on
   * when real credentials are present. Absent is treated as false.
   */
  readonly demoGeneration?: boolean
  readonly session: {
    readonly ttlSeconds: number
    readonly idleSeconds: number
    readonly maxActiveSessions: number
  }
  readonly request: {
    readonly maxBytes: number
    readonly maxPromptCharacters: number
  }
  readonly privacy: {
    readonly promptRetention: 'discard' | 'persist'
    readonly telemetryEnabled: boolean
    readonly externalDiagnosticsEnabled: boolean
  }
  readonly externalDiagnostics: {
    readonly endpoint: string | undefined
    readonly token: string | undefined
  }
  readonly telemetry: { readonly endpoint: string | undefined }
  readonly observability: {
    readonly diagnosticLogRoot: string
    readonly maxFileBytes: number
    readonly retainedFiles: number
  }
}
