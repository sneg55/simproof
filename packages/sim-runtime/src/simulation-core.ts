export const SIMULATION_CORE_PROTOCOL_VERSION = '1' as const

export interface SimulationCore<Input, Output> {
  readonly protocolVersion: typeof SIMULATION_CORE_PROTOCOL_VERSION
  readonly sample: (input: Readonly<Input>) => Output
}

interface ForbiddenCapability {
  readonly name: string
  readonly pattern: RegExp
}

const FORBIDDEN_CAPABILITIES: readonly ForbiddenCapability[] = Object.freeze([
  { name: 'clock access', pattern: /\b(?:Date|performance|Temporal)\b/u },
  {
    name: 'randomness',
    pattern: /\bMath\s*\.\s*random\b|\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b/u,
  },
  { name: 'host global access', pattern: /\bglobalThis\b/u },
  {
    name: 'process or environment access',
    pattern: /\bprocess\b|\b(?:Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b/u,
  },
  {
    name: 'network access',
    pattern: /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|navigator|sendBeacon)\b/u,
  },
  { name: 'dynamic module loading', pattern: /\b(?:require|import)\s*\(/u },
  { name: 'opaque native or bound code', pattern: /\[native code\]/u },
])

export class SimulationCorePurityError extends TypeError {
  readonly capability: string

  constructor(capability: string) {
    super(`Simulation core sample source uses forbidden ${capability}.`)
    this.name = 'SimulationCorePurityError'
    this.capability = capability
  }
}

function assertStaticallyPure(sample: (...arguments_: never[]) => unknown): void {
  const source = Function.prototype.toString.call(sample)
  const forbidden = FORBIDDEN_CAPABILITIES.find(({ pattern }) => pattern.test(source))
  if (forbidden !== undefined) throw new SimulationCorePurityError(forbidden.name)
}

export function defineSimulationCore<Input, Output>(
  sample: (input: Readonly<Input>) => Output,
): SimulationCore<Input, Output> {
  // Defense-in-depth only: generated code still requires an isolated runner security boundary.
  assertStaticallyPure(sample)
  return Object.freeze({
    protocolVersion: SIMULATION_CORE_PROTOCOL_VERSION,
    sample,
  })
}
