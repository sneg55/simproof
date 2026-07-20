import { spawn } from 'node:child_process'

export interface DockerCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export const SAFE_DOCKER_HOST_ENV = Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin' })

const DEFAULT_CAPTURE_BYTES = 16_384
const COMMAND_TIMEOUT_MS = 2_000
const KILL_SETTLE_MS = 250

export function runBoundedDockerCommand(
  command: string,
  args: readonly string[],
  captureBytes = DEFAULT_CAPTURE_BYTES,
): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: SAFE_DOCKER_HOST_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let killFallback: ReturnType<typeof setTimeout> | undefined
    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>) =>
      current.byteLength >= captureBytes
        ? current
        : Buffer.concat([current, chunk.subarray(0, captureBytes - current.byteLength)])
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killFallback !== undefined) clearTimeout(killFallback)
      resolve({
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        timedOut,
      })
    }
    child.once('error', () => finish(127))
    child.once('close', (code) => finish(code ?? 127))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      killFallback = setTimeout(() => finish(137), KILL_SETTLE_MS)
    }, COMMAND_TIMEOUT_MS)
  })
}
