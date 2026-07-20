export const inspectDeploymentArchitectures =
  process.env.SIMPROOF_INSPECT_DEPLOYMENT_ARCHITECTURES === 'true'
export const inspectDeploymentImages = process.env.SIMPROOF_INSPECT_DEPLOYMENT_IMAGES === 'true'

export function providerAbsentProcessEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('SIMPROOF_') && !/^(?:OPENAI|CODEX)(?:_|$)/u.test(name),
    ),
  )
}
