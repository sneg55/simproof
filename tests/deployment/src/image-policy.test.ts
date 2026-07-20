import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { inspectDeploymentImages } from './environment.js'

const imageNames = ['simproof-web:local', 'simproof-orchestrator:local', 'simproof-launcher:local']

interface ImageInspection {
  readonly Config: {
    readonly Env?: readonly string[]
    readonly User: string
  }
  readonly Architecture: string
  readonly Os: string
}

describe.runIf(inspectDeploymentImages)('built production images', () => {
  for (const image of imageNames) {
    it(`${image} is Linux, unprivileged, and contains no credential values`, () => {
      const inspection = inspect(image)
      expect(inspection.Os).toBe('linux')
      expect(['amd64', 'arm64']).toContain(inspection.Architecture)
      expect(inspection.Config.User).toBe('65532:65532')
      expect(inspection.Config.Env ?? []).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^(?:OPENAI|CODEX|SIMPROOF)_[A-Z0-9_]*(?:KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*=/u,
          ),
        ]),
      )
    })
  }

  it('application images contain runtime output but no TypeScript, tests, VCS, or env files', () => {
    for (const image of imageNames) {
      const listing = execFileSync(
        'docker',
        ['run', '--rm', '--entrypoint', '/usr/local/bin/node', image, '-e', listFilesScript],
        { encoding: 'utf8' },
      )
      expect(listing).not.toMatch(/(?:^|\/)(?:\.env|\.git|node_modules\/.cache)(?:\/|$)/mu)
      expect(listing).not.toMatch(/(?:\.test\.|\.spec\.|\.ts$)/mu)
    }
  })

  it('orchestrator contains no launcher implementation or Docker client', () => {
    const result = JSON.parse(
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--entrypoint',
          '/usr/local/bin/node',
          'simproof-orchestrator:local',
          '-e',
          orchestratorBoundaryScript,
        ],
        { encoding: 'utf8' },
      ),
    ) as {
      readonly dockerCli: boolean
      readonly forbiddenFiles: string[]
      readonly strings: string[]
    }
    expect(result).toEqual({ dockerCli: false, forbiddenFiles: [], strings: [] })
  })
})

function inspect(image: string): ImageInspection {
  return JSON.parse(
    execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .}}'], {
      encoding: 'utf8',
    }),
  ) as ImageInspection
}

const listFilesScript = String.raw`
  const { readdirSync } = require('node:fs');
  const walk = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = root + '/' + entry.name;
    return entry.isDirectory() ? walk(path) : [path];
  });
  process.stdout.write(walk('/app').join('\n'));
`

const orchestratorBoundaryScript = String.raw`
  const { existsSync, readFileSync, readdirSync } = require('node:fs');
  const files = [];
  const walk = (root) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = root + '/' + entry.name;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('/app');
  const forbiddenNames = /(?:docker-launcher|launcher-(?:control-plane|environment|node-server|start))/u;
  const forbiddenStrings = ['/var/run/docker.sock', 'SIMPROOF_DOCKER_SOCKET', 'docker-launcher'];
  const strings = new Set();
  for (const path of files.filter((candidate) => /\.(?:js|json|mjs)$/u.test(candidate))) {
    const content = readFileSync(path, 'utf8');
    for (const value of forbiddenStrings) if (content.includes(value)) strings.add(value);
  }
  process.stdout.write(JSON.stringify({
    dockerCli: ['/usr/bin/docker', '/usr/local/bin/docker'].some(existsSync),
    forbiddenFiles: files.filter((path) => forbiddenNames.test(path)),
    strings: [...strings].sort(),
  }));
`
