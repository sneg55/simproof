import { runnerImageDigestSchema } from '@simproof/contracts'

import { runBoundedDockerCommand } from './docker-command.js'

export const RUNNER_OWNER_LABEL = 'com.simproof.runner.owner=simproof-launcher-v1'
export const RUNNER_IMAGE_LABEL_KEY = 'com.simproof.runner.image'

export function runnerLabelArguments(image: string): readonly string[] {
  const pinned = runnerImageDigestSchema.parse(image)
  return ['--label', RUNNER_OWNER_LABEL, '--label', `${RUNNER_IMAGE_LABEL_KEY}=${pinned}`]
}

export async function removeDockerContainer(
  name: string,
  dockerCommand = 'docker',
): Promise<boolean> {
  const removed = await runBoundedDockerCommand(dockerCommand, ['container', 'rm', '--force', name])
  if (!removed.timedOut && removed.exitCode === 0) return true
  const inspected = await runBoundedDockerCommand(dockerCommand, ['container', 'inspect', name])
  return !inspected.timedOut && inspected.exitCode !== 0
}

export async function reconcileDockerContainers(
  image: string,
  dockerCommand = 'docker',
): Promise<boolean> {
  const pinned = runnerImageDigestSchema.parse(image)
  const listed = await ownedContainerIds(dockerCommand)
  if (listed === undefined) return false
  for (const id of listed) {
    const inspected = await runBoundedDockerCommand(dockerCommand, [
      'container',
      'inspect',
      '--format',
      `{{.Config.Image}}|{{index .Config.Labels "${RUNNER_IMAGE_LABEL_KEY}"}}`,
      id,
    ])
    if (
      inspected.timedOut ||
      inspected.exitCode !== 0 ||
      inspected.stdout.trim() !== `${pinned}|${pinned}` ||
      !(await removeDockerContainer(id, dockerCommand))
    ) {
      return false
    }
  }
  return (await ownedContainerIds(dockerCommand))?.length === 0
}

async function ownedContainerIds(dockerCommand: string): Promise<readonly string[] | undefined> {
  const listed = await runBoundedDockerCommand(dockerCommand, [
    'container',
    'ls',
    '--all',
    '--quiet',
    '--filter',
    `label=${RUNNER_OWNER_LABEL}`,
  ])
  if (listed.timedOut || listed.exitCode !== 0) return undefined
  const ids = listed.stdout.trim() === '' ? [] : listed.stdout.trim().split(/\s+/u)
  return ids.every((id) => /^[a-f\d]{12,64}$/u.test(id)) ? ids : undefined
}
