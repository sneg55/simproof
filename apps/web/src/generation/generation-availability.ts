import type { GenerationAvailability } from '@simproof/contracts'

/**
 * True when generation is served by the fenced, credential-free demo provider.
 * The verifier and policy remain real; only the model outputs are scripted, so
 * the UI must label these runs so a demo verdict is never mistaken for a live
 * model run.
 */
export function isDemoGeneration(availability: GenerationAvailability): boolean {
  return availability.available && availability.demo === true
}

export function generationUnavailableDescription(
  availability: GenerationAvailability,
): string | null {
  if (availability.available) return null
  switch (availability.reason) {
    case 'provider-not-configured':
      return 'Generation provider credentials are not configured. Ask a server administrator to configure generation.'
    case 'runner-unavailable':
      return 'The isolated generation runner is unavailable. Ask a server administrator to restore it before starting a run.'
    case 'generation-disabled':
      return 'Generation is disabled by server configuration. Bundled simulations remain available.'
  }
}
