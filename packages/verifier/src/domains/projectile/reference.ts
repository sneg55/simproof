import type { ProjectileInput, ProjectileTrajectorySample } from '@simproof/contracts'

export const PROJECTILE_GRAVITY_MPS2 = 9.81

export interface ProjectileReference {
  readonly rangeM: number
  readonly apexHeightM: number
  readonly flightTimeS: number
}

export function projectileReference(input: ProjectileInput): ProjectileReference {
  const angleRad = (input.launchAngleDeg * Math.PI) / 180
  const verticalSpeedMps = input.initialSpeedMps * Math.sin(angleRad)
  const flightTimeS = (2 * verticalSpeedMps) / PROJECTILE_GRAVITY_MPS2
  return {
    rangeM: input.initialSpeedMps * Math.cos(angleRad) * flightTimeS,
    apexHeightM: verticalSpeedMps ** 2 / (2 * PROJECTILE_GRAVITY_MPS2),
    flightTimeS,
  }
}

export function projectileStateAtTime(
  input: ProjectileInput,
  timeS: number,
): ProjectileTrajectorySample {
  const angleRad = (input.launchAngleDeg * Math.PI) / 180
  const horizontalSpeedMps = input.initialSpeedMps * Math.cos(angleRad)
  const initialVerticalSpeedMps = input.initialSpeedMps * Math.sin(angleRad)
  const verticalSpeedMps = initialVerticalSpeedMps - PROJECTILE_GRAVITY_MPS2 * timeS
  return {
    timeS,
    xM: horizontalSpeedMps * timeS,
    yM: initialVerticalSpeedMps * timeS - 0.5 * PROJECTILE_GRAVITY_MPS2 * timeS ** 2,
    speedMps: Math.hypot(horizontalSpeedMps, verticalSpeedMps),
  }
}
