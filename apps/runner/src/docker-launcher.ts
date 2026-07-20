import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { type RunnerLimits, runnerImageDigestSchema } from '@simproof/contracts'
import { runBoundedDockerCommand, SAFE_DOCKER_HOST_ENV } from './docker-command.js'
import { removeDockerContainer, runnerLabelArguments } from './docker-container-lifecycle.js'

export interface DockerInvocation {
  readonly command: 'docker'
  readonly args: readonly string[]
}

export type IsolationResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'output-limit' }
  | { readonly kind: 'internal' }
  | {
      readonly kind: 'exited'
      readonly exitCode: number
      readonly stdout: string
      readonly stderr: string
    }

export interface LaunchOptions {
  readonly signal?: AbortSignal
  readonly dockerCommand?: string
  readonly containerName?: string
}

const CPU_LIMIT = '0.5'
const PROCESS_LIMIT = '32'
const TEMP_BYTES = 16_777_216
const RUNTIME_UID = '65532'
const STOP_SETTLE_MS = 2_500
function assertPinnedImage(image: string): void {
  if (!runnerImageDigestSchema.safeParse(image).success) {
    throw new TypeError('RUNNER_IMAGE_NOT_PINNED')
  }
}

function assertContainerName(name: string): void {
  if (!/^simproof-runner-[a-f\d-]+$/u.test(name)) throw new TypeError('RUNNER_NAME_INVALID')
}

export function buildDockerInvocation(
  image: string,
  limits: RunnerLimits,
  containerName = `simproof-runner-${randomUUID()}`,
): DockerInvocation {
  assertPinnedImage(image)
  assertContainerName(containerName)
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '--interactive',
      '--name',
      containerName,
      '--pull',
      'never',
      ...runnerLabelArguments(image),
      '--user',
      `${RUNTIME_UID}:${RUNTIME_UID}`,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges=true',
      '--pids-limit',
      PROCESS_LIMIT,
      '--memory',
      `${limits.memoryBytes}b`,
      '--memory-swap',
      `${limits.memoryBytes}b`,
      '--cpus',
      CPU_LIMIT,
      '--ulimit',
      'nofile=64:64',
      '--tmpfs',
      `/work:rw,noexec,nosuid,nodev,size=${TEMP_BYTES},mode=0700,uid=${RUNTIME_UID},gid=${RUNTIME_UID}`,
      '--env',
      `RUNNER_MAX_OUTPUT_BYTES=${limits.maxOutputBytes}`,
      '--workdir',
      '/work',
      image,
    ],
  }
}

interface CapturedOutput {
  stderr: string
  stdout: string
  totalBytes: number
}

export function launchDockerContainer(
  image: string,
  limits: RunnerLimits,
  input: string,
  options: LaunchOptions = {},
): Promise<IsolationResult> {
  const containerName = options.containerName ?? `simproof-runner-${randomUUID()}`
  const invocation = buildDockerInvocation(image, limits, containerName)
  const command = options.dockerCommand ?? invocation.command
  return new Promise((resolve) => {
    const isAborted = () => options.signal?.aborted === true
    if (isAborted()) {
      resolve({ kind: 'cancelled' })
      return
    }
    const child = spawn(command, invocation.args, {
      env: SAFE_DOCKER_HOST_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const captured: CapturedOutput = { stderr: '', stdout: '', totalBytes: 0 }
    let terminalKind: 'cancelled' | 'output-limit' | 'timeout' | undefined
    let cleanup: Promise<boolean> | undefined
    let resolved = false
    let stopFallback: ReturnType<typeof setTimeout> | undefined
    let terminalSettlement: Promise<void> | undefined
    const requestStop = (kind: NonNullable<typeof terminalKind>): void => {
      if (terminalKind !== undefined) return
      terminalKind = kind
      child.stdin.destroy()
      child.kill('SIGKILL')
      cleanup = removeDockerContainer(containerName, command)
      stopFallback = setTimeout(() => {
        void settleTerminal()
      }, STOP_SETTLE_MS)
    }
    const settleTerminal = (): Promise<void> => {
      terminalSettlement ??= (async () => {
        const cleaned = await (cleanup ?? Promise.resolve(false))
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        if (stopFallback !== undefined) clearTimeout(stopFallback)
        options.signal?.removeEventListener('abort', onAbort)
        resolve(
          cleaned && terminalKind !== undefined ? { kind: terminalKind } : { kind: 'internal' },
        )
      })()
      return terminalSettlement
    }
    const capture = (stream: 'stderr' | 'stdout', chunk: Buffer): void => {
      captured.totalBytes += chunk.byteLength
      if (captured.totalBytes > limits.maxOutputBytes) {
        requestStop('output-limit')
        return
      }
      if (stream === 'stdout') captured.stdout += chunk.toString('utf8')
      else captured.stderr += chunk.toString('utf8')
    }
    const onAbort = (): void => requestStop('cancelled')
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (isAborted()) requestStop('cancelled')
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk))
    child.on('error', (error) => {
      captured.stderr = error.message.slice(0, limits.maxOutputBytes)
    })
    const timer = setTimeout(() => requestStop('timeout'), limits.timeoutMs)
    child.on('close', (exitCode) => {
      if (resolved) return
      clearTimeout(timer)
      if (terminalKind !== undefined) {
        void settleTerminal()
      } else {
        resolved = true
        options.signal?.removeEventListener('abort', onAbort)
        resolve({ kind: 'exited', exitCode: exitCode ?? 127, ...captured })
      }
    })
    child.stdin.end(input)
  })
}

export function probeDockerImage(image: string, dockerCommand = 'docker'): Promise<boolean> {
  assertPinnedImage(image)
  return runBoundedDockerCommand(dockerCommand, ['image', 'inspect', image]).then(
    (result) => !result.timedOut && result.exitCode === 0,
  )
}
