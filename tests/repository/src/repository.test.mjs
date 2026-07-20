import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateRepositoryAutomation } from '../../../scripts/check-repository-automation.mjs'
import { scanSecretFiles } from '../../../scripts/check-secrets.mjs'
import { runReleaseEvidenceCli } from '../../../scripts/generate-release-evidence.mjs'
import { generateReleaseEvidence } from '../../../scripts/release-evidence.mjs'
import { verifyReleaseEvidence } from '../../../scripts/release-evidence-verifier.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const arbitraryRevision = 'a'.repeat(40)
const digest = (character) => `sha256:${character.repeat(64)}`
const images = [
  { reference: 'simproof-web:local', digest: digest('1') },
  { reference: 'simproof-orchestrator:local', digest: digest('2') },
  { reference: 'simproof-launcher:local', digest: digest('3') },
  { reference: 'simproof-runner:local', digest: digest('4') },
]
const releaseBuildEnvironment = {
  SIMPROOF_DOCKER_GID: '0',
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'release-build-placeholder',
  SIMPROOF_SESSION_SECRET: 'release-build-placeholder',
  SIMPROOF_RUNNER_TOKEN: 'release-build-placeholder',
  SIMPROOF_RUNNER_IMAGE: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  SIMPROOF_DOCKER_SOCKET: '/var/run/docker.sock',
}
const requiredFiles = [
  'README.md',
  'LICENSE',
  'LICENSE-CONTENT',
  'NOTICE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'docs/operations/releases-and-support.md',
  '.github/pull_request_template.md',
  ...[
    'bug',
    'domain-pack',
    'scientific-correction',
    'accessibility',
    'deployment',
    'security',
    'config',
  ].map((name) => `.github/ISSUE_TEMPLATE/${name}.yml`),
]
const plan012Files = [
  ...requiredFiles,
  '.node-version',
  '.github/dependabot.yml',
  '.github/secret_scanning.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/release.yml',
  'scripts/check-repository-automation.mjs',
  'scripts/check-secrets.mjs',
  'scripts/generate-release-evidence.mjs',
  'scripts/release-evidence.mjs',
  'scripts/release-evidence-verifier.mjs',
  'scripts/release-metadata.mjs',
  'scripts/release-source.mjs',
  'tests/repository/package.json',
  'tests/repository/src/repository.test.mjs',
  'tests/repository/fixtures/secret-canary.txt',
]

test('required public repository files exist and local Markdown links resolve', async () => {
  for (const path of requiredFiles) await assert.doesNotReject(readFile(resolve(root, path)))
  const markdown = requiredFiles.filter((path) => path.endsWith('.md'))
  for (const path of markdown) {
    const source = await readFile(resolve(root, path), 'utf8')
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1].split('#')[0]
      if (target === '' || /^(?:https?:|mailto:)/u.test(target)) continue
      await assert.doesNotReject(stat(resolve(root, dirname(path), target)), `${path} -> ${target}`)
    }
  }
})

test('automation configuration is pinned, least-privilege, and non-publishing', async () => {
  assert.deepEqual(await validateRepositoryAutomation(root), [])
})

test('release build placeholders resolve the complete build-only Compose profile', () => {
  const output = execFileSync(
    'docker',
    ['compose', '--profile', 'image-only', 'config', '--images'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...releaseBuildEnvironment } },
  )
  assert.deepEqual(output.trim().split('\n').sort(), [
    'simproof-launcher:local',
    'simproof-orchestrator:local',
    'simproof-runner:local',
    'simproof-web:local',
  ])
})

test('automation validation rejects added commands, permissions, paths, and missing form fields', async () => {
  for (const [path, search, replacement] of [
    [
      '.github/workflows/release.yml',
      'run: pnpm check',
      'run: pnpm check && curl https://example.invalid',
    ],
    [
      '.github/workflows/codeql.yml',
      'permissions:\n  contents: read',
      'permissions:\n  contents: read\n  actions: write',
    ],
    ['.github/dependabot.yml', '- /apps/runner', '- /wrong'],
    ['.github/ISSUE_TEMPLATE/bug.yml', 'id: summary', 'id: removed'],
  ]) {
    const fixture = await mkdtemp(join(tmpdir(), 'simproof-automation-'))
    await cp(resolve(root, '.github'), join(fixture, '.github'), { recursive: true })
    const source = await readFile(join(fixture, path), 'utf8')
    assert.notEqual(source.replace(search, replacement), source)
    await writeFile(join(fixture, path), source.replace(search, replacement))
    assert.notDeepEqual(await validateRepositoryAutomation(fixture), [])
  }
})

test('templates cover release review and redirect vulnerability reports privately', async () => {
  const pullRequest = await readFile(resolve(root, '.github/pull_request_template.md'), 'utf8')
  for (const term of [
    'test',
    'verification',
    'policy',
    'migration',
    'accessibility',
    'generated-code',
  ]) {
    assert.match(pullRequest.toLowerCase(), new RegExp(term, 'u'))
  }
  assert.match(pullRequest, /- \[ \]/u)
  const security = await readFile(resolve(root, '.github/ISSUE_TEMPLATE/security.yml'), 'utf8')
  assert.match(security, /SECURITY\.md/u)
  assert.doesNotMatch(security, /type:\s*(?:input|textarea|dropdown|checkboxes)/u)
})

test('release evidence is deterministic and binds the exact image, source, and lock identities', async () => {
  const fixture = await cleanReleaseFixture()
  const parent = await mkdtemp(join(tmpdir(), 'simproof-release-'))
  const first = join(parent, 'first')
  const second = join(parent, 'second')
  const options = {
    root: fixture.root,
    releaseVersion: '1.2.3',
    sourceRevision: fixture.revision,
    sourceDateEpoch: fixture.sourceDateEpoch,
    images,
  }
  await generateReleaseEvidence({ ...options, outputDirectory: first })
  await generateReleaseEvidence({ ...options, outputDirectory: second })
  const names = [
    'checksums.txt',
    'migration-notes.json',
    'provenance.intoto.json',
    'release-manifest.json',
    'release-notes.md',
    'sbom.spdx.json',
  ]
  for (const name of names) {
    assert.deepEqual(await readFile(join(first, name)), await readFile(join(second, name)))
  }
  const manifest = await verifyReleaseEvidence({ root: fixture.root, outputDirectory: first })
  assert.deepEqual(
    manifest.images,
    [...images].sort((a, b) => a.reference.localeCompare(b.reference)),
  )
  const sbom = JSON.parse(await readFile(join(first, 'sbom.spdx.json'), 'utf8'))
  const provenance = JSON.parse(await readFile(join(first, 'provenance.intoto.json'), 'utf8'))
  assert.equal(
    provenance.predicate.buildDefinition.externalParameters.sourceDateEpoch,
    fixture.sourceDateEpoch,
  )
  assert.equal(provenance.predicate.runDetails.metadata, undefined)
  assert.ok(sbom.packages.every((item) => item.licenseDeclared === 'NOASSERTION'))
  assert.ok(sbom.packages.every((item) => item.supplier === undefined))
  assert.equal(
    sbom.packages.filter((item) => item.packageComment?.startsWith('Image identity only')).length,
    4,
  )
})

test('complete release input identity changes with version or image identity', async () => {
  const fixture = await cleanReleaseFixture()
  const parent = await mkdtemp(join(tmpdir(), 'simproof-input-identity-'))
  const variants = [
    ['base', '1.2.3', images],
    ['version', '1.2.4', images],
    [
      'image',
      '1.2.3',
      images.map((image) =>
        image.reference === 'simproof-web:local' ? { ...image, digest: digest('5') } : image,
      ),
    ],
  ]
  const identities = []
  for (const [name, releaseVersion, releaseImages] of variants) {
    const outputDirectory = join(parent, name)
    const manifest = await generateReleaseEvidence({
      root: fixture.root,
      outputDirectory,
      releaseVersion,
      sourceRevision: fixture.revision,
      sourceDateEpoch: fixture.sourceDateEpoch,
      images: releaseImages,
    })
    const sbom = JSON.parse(await readFile(join(outputDirectory, 'sbom.spdx.json'), 'utf8'))
    const provenance = JSON.parse(
      await readFile(join(outputDirectory, 'provenance.intoto.json'), 'utf8'),
    )
    assert.equal(sbom.documentNamespace, `urn:simproof:spdx:${manifest.inputIdentity}`)
    assert.equal(
      provenance.predicate.buildDefinition.externalParameters.inputIdentity,
      manifest.inputIdentity,
    )
    identities.push(manifest.inputIdentity)
  }
  assert.equal(new Set(identities).size, variants.length)
})

test('release versions enforce SemVer 2.0 identifier rules', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'simproof-semver-'))
  for (const [index, releaseVersion] of [
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-alpha..1',
    '1.2.3-01',
  ].entries()) {
    await assert.rejects(
      generateReleaseEvidence({
        root,
        outputDirectory: join(parent, String(index)),
        releaseVersion,
        sourceRevision: arbitraryRevision,
        sourceDateEpoch: 1,
        images,
      }),
      /release version/u,
    )
  }
})

test('release CLI binds generation and verification to clean Git revision and epoch', async () => {
  const fixture = await cleanReleaseFixture()
  const parent = await mkdtemp(join(tmpdir(), 'simproof-cli-'))
  const output = join(parent, 'evidence')
  const args = releaseArguments(output, fixture)
  const manifest = await runReleaseEvidenceCli(args, { root: fixture.root })
  assert.equal(manifest.sourceRevision, fixture.revision)
  await assert.doesNotReject(runReleaseEvidenceCli(['--verify', output], { root: fixture.root }))
  await assert.rejects(
    runReleaseEvidenceCli(
      releaseArguments(join(parent, 'wrong-revision'), {
        ...fixture,
        revision: arbitraryRevision,
      }),
      { root: fixture.root },
    ),
    /current Git HEAD/u,
  )
  await assert.rejects(
    runReleaseEvidenceCli(
      releaseArguments(join(parent, 'wrong-epoch'), {
        ...fixture,
        sourceDateEpoch: fixture.sourceDateEpoch + 1,
      }),
      { root: fixture.root },
    ),
    /commit epoch/u,
  )
  await writeFile(join(fixture.root, 'untracked.txt'), 'dirty')
  await assert.rejects(
    runReleaseEvidenceCli(releaseArguments(join(parent, 'dirty'), fixture), {
      root: fixture.root,
    }),
    /clean index and worktree/u,
  )
  await assert.rejects(
    verifyReleaseEvidence({ root: fixture.root, outputDirectory: output }),
    /clean index and worktree/u,
  )
})

test('release generation rejects missing, duplicate, or wrong image identities', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'simproof-images-'))
  const base = {
    root,
    releaseVersion: '1.2.3',
    sourceRevision: arbitraryRevision,
    sourceDateEpoch: 1,
  }
  await assert.rejects(
    generateReleaseEvidence({
      ...base,
      images: images.slice(1),
      outputDirectory: join(parent, 'missing'),
    }),
  )
  await assert.rejects(
    generateReleaseEvidence({
      ...base,
      images: [...images.slice(0, 3), images[0]],
      outputDirectory: join(parent, 'duplicate'),
    }),
  )
  await assert.rejects(
    generateReleaseEvidence({
      ...base,
      images: [...images.slice(0, 3), { reference: 'wrong:local', digest: digest('5') }],
      outputDirectory: join(parent, 'wrong'),
    }),
  )
})

test('release verification rejects re-bound semantic tampering', async () => {
  const fixture = await cleanReleaseFixture()
  for (const [name, file, mutate] of [
    [
      'image',
      'release-manifest.json',
      (value) => {
        value.images = value.images.slice(1)
      },
    ],
    [
      'manifest-schema',
      'release-manifest.json',
      (value) => {
        value.schemaVersion = '2'
      },
    ],
    [
      'namespace',
      'sbom.spdx.json',
      (value) => {
        value.documentNamespace = 'urn:wrong'
      },
    ],
    [
      'sbom-creation',
      'sbom.spdx.json',
      (value) => {
        value.creationInfo.created = '2000-01-01T00:00:00.000Z'
      },
    ],
    [
      'provenance',
      'provenance.intoto.json',
      (value) => {
        value.predicate.buildDefinition.buildType = 'urn:wrong'
      },
    ],
    [
      'provenance-input',
      'provenance.intoto.json',
      (value) => {
        value.predicate.buildDefinition.externalParameters.inputIdentity = '0'.repeat(64)
      },
    ],
    [
      'migration-source',
      'migration-notes.json',
      (value) => {
        value.migrationSource = '../outside'
      },
    ],
    [
      'migration-schema',
      'migration-notes.json',
      (value) => {
        value.schemaVersion = '2'
      },
    ],
    [
      'migration-list',
      'migration-notes.json',
      (value) => {
        value.migrations = value.migrations.slice(0, -1)
      },
    ],
  ]) {
    const parent = await mkdtemp(join(tmpdir(), `simproof-tamper-${name}-`))
    const output = join(parent, 'bundle')
    await generateReleaseEvidence({
      root: fixture.root,
      outputDirectory: output,
      releaseVersion: '1.2.3',
      sourceRevision: fixture.revision,
      sourceDateEpoch: fixture.sourceDateEpoch,
      images,
    })
    const value = JSON.parse(await readFile(join(output, file), 'utf8'))
    mutate(value)
    await writeFile(join(output, file), `${JSON.stringify(value, null, 2)}\n`)
    await rebindEvidence(output, file)
    await assert.rejects(verifyReleaseEvidence({ root: fixture.root, outputDirectory: output }))
  }
})

test('clean-checkout onboarding inventory validates seed-only deployment configuration', async () => {
  const inventory = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  assert.ok(inventory.length > 0)
  for (const path of plan012Files) assert.ok(inventory.includes(path), `untracked: ${path}`)
  assert.ok(
    inventory.every(
      (path) =>
        !/(?:^|\/)(?:node_modules|dist|\.pnpm-store|\.simproof)(?:\/|$)/u.test(path) &&
        !/(?:^|\/)\.env$/u.test(path),
    ),
  )
  const checkout = await mkdtemp(join(tmpdir(), 'simproof-onboarding-'))
  for (const path of inventory) {
    const source = resolve(root, path)
    const metadata = await lstat(source)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), path)
    const destination = join(checkout, path)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination)
  }
  const environmentSource = (await readFile(join(checkout, '.env.example'), 'utf8'))
    .replace(
      'SIMPROOF_ADMIN_BOOTSTRAP_SECRET=',
      'SIMPROOF_ADMIN_BOOTSTRAP_SECRET=onboarding-placeholder',
    )
    .replace('SIMPROOF_SESSION_SECRET=', 'SIMPROOF_SESSION_SECRET=onboarding-placeholder')
    .replace('SIMPROOF_RUNNER_TOKEN=', 'SIMPROOF_RUNNER_TOKEN=onboarding-placeholder')
  await writeFile(join(checkout, '.env'), environmentSource)
  await mkdir(join(checkout, '.simproof'))
  await writeFile(
    join(checkout, '.simproof/deployment.generated.env'),
    [
      `SIMPROOF_RUNNER_IMAGE=${digest('0')}`,
      'SIMPROOF_DOCKER_SOCKET=/var/run/docker.sock',
      'SIMPROOF_DOCKER_GID=0',
      `SIMPROOF_RUNNER_SOURCE_SHA256=${'0'.repeat(64)}`,
      '',
    ].join('\n'),
  )
  const cleanEnvironment = { ...process.env }
  for (const name of Object.keys(cleanEnvironment)) {
    if (/^(?:SIMPROOF|OPENAI|CODEX)(?:_|$)/u.test(name)) delete cleanEnvironment[name]
  }
  execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env',
      '--env-file',
      '.simproof/deployment.generated.env',
      'config',
      '--quiet',
    ],
    { cwd: checkout, env: cleanEnvironment, stdio: 'pipe' },
  )
  assert.doesNotMatch(environmentSource, /^(?:OPENAI|CODEX)[A-Z0-9_]*=/mu)
  const seeds = await readFile(
    join(checkout, 'apps/orchestrator/src/seeds/bundled-seed-definitions.ts'),
    'utf8',
  )
  assert.match(seeds, /contentLicense:\s*'CC-BY-4\.0'/u)
})

test('every bundled seed has an explicit unique CC-BY-4.0 declaration', async () => {
  const source = await readFile(
    resolve(root, 'apps/orchestrator/src/seeds/bundled-seed-definitions.ts'),
    'utf8',
  )
  const declarations = [
    ...source.matchAll(/seedId:\s*'([^']+)'[\s\S]*?contentLicense:\s*'([^']+)'/gu),
  ].map((match) => ({ exampleId: match[1], contentLicense: match[2] }))
  const installed = [...source.matchAll(/definition\(\s*'(?:pendulum|projectile)'/gu)]
  assert.equal(declarations.length, installed.length)
  assert.equal(new Set(declarations.map((item) => item.exampleId)).size, declarations.length)
  assert.ok(declarations.every((item) => item.contentLicense === 'CC-BY-4.0'))
})

test('secret fixture is detected without printing the canary and symlinks fail closed', async () => {
  const fixture = 'tests/repository/fixtures/secret-canary.txt'
  const findings = await scanSecretFiles([fixture], { root })
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['test-canary'],
  )
  assert.throws(
    () =>
      execFileSync(process.execPath, ['scripts/check-secrets.mjs', fixture], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (error) => !String(error.stderr).includes('SIMPROOF_FAKE_SECRET_'),
  )
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['scripts/check-secrets.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  )
  const parent = await mkdtemp(join(tmpdir(), 'simproof-secret-link-'))
  await writeFile(join(parent, 'outside.txt'), 'ordinary text')
  await symlink(join(parent, 'outside.txt'), join(root, 'tests/repository/fixtures/outside-link'))
  try {
    await assert.rejects(
      scanSecretFiles(['tests/repository/fixtures/outside-link'], { root }),
      /non-regular/u,
    )
  } finally {
    await unlink(join(root, 'tests/repository/fixtures/outside-link'))
  }
})

async function rebindEvidence(output, changedFile) {
  const manifestPath = join(output, 'release-manifest.json')
  if (changedFile !== 'release-manifest.json') {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const artifact = manifest.artifacts.find((item) => item.path === changedFile)
    assert.ok(artifact)
    artifact.sha256 = await fileSha256(join(output, changedFile))
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  const names = [
    'migration-notes.json',
    'provenance.intoto.json',
    'release-manifest.json',
    'release-notes.md',
    'sbom.spdx.json',
  ]
  const lines = await Promise.all(
    names.map(async (name) => `${await fileSha256(join(output, name))}  ${name}\n`),
  )
  await writeFile(join(output, 'checksums.txt'), lines.join(''))
}

async function fileSha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function cleanReleaseFixture() {
  const parent = await mkdtemp(join(tmpdir(), 'simproof-clean-source-'))
  const repository = join(parent, 'repository')
  await mkdir(join(repository, 'packages/persistence/src'), { recursive: true })
  for (const path of ['pnpm-lock.yaml', 'CHANGELOG.md', 'packages/persistence/src/migrations.ts']) {
    await cp(resolve(root, path), join(repository, path))
  }
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  const commitEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: '2023-11-14T22:13:20Z',
    GIT_COMMITTER_DATE: '2023-11-14T22:13:20Z',
  }
  execFileSync(
    'git',
    [
      '-c',
      'user.name=SimProof Test',
      '-c',
      'user.email=test@simproof.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: repository, env: commitEnvironment },
  )
  return {
    root: repository,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim(),
    sourceDateEpoch: Number(
      execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
    ),
  }
}

function releaseArguments(output, fixture) {
  return [
    '--output',
    output,
    '--release-version',
    '1.2.3',
    '--source-revision',
    fixture.revision,
    '--source-date-epoch',
    String(fixture.sourceDateEpoch),
    ...images.flatMap((image) => ['--image', `${image.reference}=${image.digest}`]),
  ]
}
