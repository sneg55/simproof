import type { RunnerLimits } from '@simproof/contracts'

import { reconcileDockerContainers } from './docker-container-lifecycle.js'
import { type IsolationResult, launchDockerContainer, probeDockerImage } from './docker-launcher.js'

export interface DockerLauncherRuntime {
  readonly initialize: () => Promise<boolean>
  readonly launch: (
    input: string,
    limits: RunnerLimits,
    signal?: AbortSignal,
  ) => Promise<IsolationResult>
  readonly readiness: () => Promise<boolean>
  readonly close: () => Promise<boolean>
}

export function createDockerLauncherRuntime(
  image: string,
  dockerCommand = 'docker',
): DockerLauncherRuntime {
  let healthy = false
  let closed = false
  const active = new Map<Promise<IsolationResult>, AbortController>()
  return Object.freeze({
    async initialize() {
      if (closed) return false
      healthy = await reconcileDockerContainers(image, dockerCommand)
      return healthy
    },
    async launch(input: string, limits: RunnerLimits, signal?: AbortSignal) {
      if (closed || !healthy) return { kind: 'internal' as const }
      const controller = new AbortController()
      const combined =
        signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
      const operation = launchDockerContainer(image, limits, input, {
        dockerCommand,
        signal: combined,
      })
      active.set(operation, controller)
      try {
        const result = await operation
        if (result.kind === 'internal') healthy = false
        return result
      } finally {
        active.delete(operation)
      }
    },
    async readiness() {
      return !closed && healthy && (await probeDockerImage(image, dockerCommand))
    },
    async close() {
      if (closed) return healthy
      closed = true
      const operations = [...active.entries()]
      for (const [, controller] of operations) controller.abort()
      await Promise.allSettled(operations.map(([operation]) => operation))
      healthy = await reconcileDockerContainers(image, dockerCommand)
      return healthy
    },
  })
}
