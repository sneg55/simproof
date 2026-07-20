import { describe, expect, it } from 'vitest'

import { LauncherConfigurationError, parseLauncherEnvironment } from './launcher-environment.js'

const required = {
  SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
  SIMPROOF_RUNNER_TOKEN: 'launcher-secret-with-at-least-thirty-two-characters',
}

describe('launcher environment', () => {
  it('uses the bounded internal TCP defaults', () => {
    expect(parseLauncherEnvironment(required)).toMatchObject({
      image: required.SIMPROOF_RUNNER_IMAGE,
      listen: { kind: 'tcp', host: '0.0.0.0', port: 4_318 },
      maxRequestBytes: 1_048_576,
      maxConcurrent: 2,
    })
  })

  it('rejects mutable images, weak secrets, unsafe hosts, and unbounded values without echoing them', () => {
    const secret = 'exposed'
    expect.assertions(3)
    try {
      parseLauncherEnvironment({
        SIMPROOF_RUNNER_IMAGE: 'simproof-runner:latest',
        SIMPROOF_RUNNER_TOKEN: secret,
        SIMPROOF_LAUNCHER_HOST: '::',
        SIMPROOF_LAUNCHER_MAX_CONCURRENT: '500',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherConfigurationError)
      expect(error).toMatchObject({
        fields: expect.arrayContaining([
          'SIMPROOF_RUNNER_IMAGE',
          'SIMPROOF_RUNNER_TOKEN',
          'SIMPROOF_LAUNCHER_HOST',
          'SIMPROOF_LAUNCHER_MAX_CONCURRENT',
        ]),
      })
      expect(String(error)).not.toContain(secret)
    }
  })

  it('uses the one shared launcher request ceiling', () => {
    expect(() =>
      parseLauncherEnvironment({
        ...required,
        SIMPROOF_LAUNCHER_MAX_REQUEST_BYTES: '1048577',
      }),
    ).toThrowError(/SIMPROOF_LAUNCHER_MAX_REQUEST_BYTES/u)
  })

  it('rejects a name-qualified digest instead of treating it as a local image ID', () => {
    expect(() =>
      parseLauncherEnvironment({
        ...required,
        SIMPROOF_RUNNER_IMAGE: `simproof-runner@sha256:${'a'.repeat(64)}`,
      }),
    ).toThrowError(/SIMPROOF_RUNNER_IMAGE/u)
  })

  it('rejects the unsupported Unix listener configuration', () => {
    expect(() =>
      parseLauncherEnvironment({
        ...required,
        SIMPROOF_LAUNCHER_SOCKET: '/run/simproof/runner.sock',
      }),
    ).toThrowError(/SIMPROOF_LAUNCHER_SOCKET/u)
  })
})
