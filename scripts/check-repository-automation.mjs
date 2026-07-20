import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseDocument } from 'yaml'

const STEP_DIGESTS = Object.freeze({
  codeql: [
    '3cd9f16945df6f1f298a835affd86e57299392ecb513c05cd9c4f1dcc6557650',
    '6f8cad196acfcb10bea5ebf23f41c62338ae1712ae2587c0ef35784e4b65db13',
    'b0ca1aa0c4b79016e908360177ed85c39c069d4cf61892003bfe4d40e9608cdf',
  ],
  dependency: [
    '3cd9f16945df6f1f298a835affd86e57299392ecb513c05cd9c4f1dcc6557650',
    '33bf553559cd5891c2d77063c41f92c2f07ced39fa1673b8754d3a8579949a98',
  ],
  release: [
    '6899961ed49c123bdc049d721a8862fe20c326431228345e5d31bcbec3fb1917',
    '499c5b237e8b5d764a3aa20208d5a7517860e916d76dff772d0cbc16c8a984ec',
    '3de60eefa5e1e92267b5903d7b2b25b5c82c0a113ecebadd69c3859de36f314b',
    'a23673d28692bb5bbf36b410397c1c99fbdcf6a6d0023f38bc44385dd1ef8d24',
    '565bbdf2ce02c2de9531930fecb85ac085efcc02e0f7f33c1ac903b507732fc3',
    'df533deb94209c1f764cc67a6bf82b6ce308ff944b984669701ebfa20e512bb4',
    '809dd59a15e31d4f98d27622663b8b73c83928c22503eeb865b6425ef2965b9e',
    '67527457d3ded976b3f8088885afcda66279941801b49dcf8a03eae394fff959',
    '8d1f5ca11c2fe6a4c284f62975c75cd217542ed059e2032eb798ace3dfa22e9d',
  ],
})

const ISSUE_FIELDS = Object.freeze({
  accessibility: ['workflow', 'reproduction', 'impact', 'expected', 'checks'],
  bug: ['summary', 'component', 'reproduction', 'expected', 'version', 'checks'],
  deployment: ['identity', 'phase', 'platform', 'reproduction', 'outcome', 'checks'],
  'domain-pack': [
    'domain',
    'applicability',
    'reference',
    'tolerances',
    'controls',
    'presentation',
    'governance',
    'rights',
  ],
  'scientific-correction': [
    'identity',
    'checks',
    'issue',
    'evidence',
    'calibration',
    'regression',
    'compatibility',
    'safe',
  ],
})

export async function validateRepositoryAutomation(root) {
  const failures = []
  const dependabot = await yaml(root, '.github/dependabot.yml', failures)
  const secrets = await yaml(root, '.github/secret_scanning.yml', failures)
  const codeql = await yaml(root, '.github/workflows/codeql.yml', failures)
  const dependency = await yaml(root, '.github/workflows/dependency-review.yml', failures)
  const release = await yaml(root, '.github/workflows/release.yml', failures)
  validateDependabot(dependabot, failures)
  if (!same(secrets, { 'paths-ignore': [] }))
    failures.push('Secret scanning exclusions are invalid.')
  validateWorkflow(codeql, 'analyze', STEP_DIGESTS.codeql, failures)
  validateWorkflow(dependency, 'review', STEP_DIGESTS.dependency, failures)
  validateWorkflow(release, 'dry-run', STEP_DIGESTS.release, failures)
  validateWorkflowPolicy(codeql, dependency, release, failures)
  await validateIssueTemplates(root, failures)
  return failures
}

function validateDependabot(value, failures) {
  if (value?.version !== 2 || !Array.isArray(value.updates) || value.updates.length !== 3) {
    failures.push('Dependabot configuration is invalid.')
    return
  }
  const byEcosystem = Object.fromEntries(
    value.updates.map((entry) => [entry['package-ecosystem'], entry]),
  )
  if (
    !same(Object.keys(byEcosystem).sort(), ['docker', 'github-actions', 'npm']) ||
    byEcosystem.npm?.directory !== '/' ||
    !same(byEcosystem.docker?.directories, ['/', '/apps/runner']) ||
    byEcosystem['github-actions']?.directory !== '/' ||
    value.updates.some((entry) => entry.schedule?.interval !== 'weekly')
  ) {
    failures.push('Dependabot ecosystem paths or schedules are invalid.')
  }
}

function validateWorkflow(workflow, jobName, expectedSteps, failures) {
  const jobs = workflow?.jobs
  const job = jobs?.[jobName]
  const actualSteps = (job?.steps ?? []).map((step) => sha256(JSON.stringify(step)))
  if (!same(Object.keys(jobs ?? {}), [jobName]) || !same(actualSteps, expectedSteps)) {
    failures.push(`${jobName} workflow contains an unapproved job or step.`)
  }
}

function validateWorkflowPolicy(codeql, dependency, release, failures) {
  if (
    !same(codeql?.permissions, { contents: 'read' }) ||
    !same(codeql?.jobs?.analyze?.permissions, { contents: 'read', 'security-events': 'write' }) ||
    !same(Object.keys(codeql?.on ?? {}).sort(), [
      'pull_request',
      'push',
      'schedule',
      'workflow_dispatch',
    ])
  ) {
    failures.push('CodeQL permissions or triggers are invalid.')
  }
  if (
    !same(dependency?.permissions, { contents: 'read' }) ||
    !same(Object.keys(dependency?.on ?? {}), ['pull_request']) ||
    dependency?.jobs?.review?.permissions !== undefined
  ) {
    failures.push('Dependency review permissions or triggers are invalid.')
  }
  const dispatch = release?.on?.workflow_dispatch
  const buildStep = release?.jobs?.['dry-run']?.steps?.[7]
  if (
    !same(release?.permissions, { contents: 'read' }) ||
    !same(Object.keys(release?.on ?? {}), ['workflow_dispatch']) ||
    !same(Object.keys(dispatch?.inputs ?? {}).sort(), ['dry_run', 'release_version']) ||
    dispatch?.inputs?.dry_run?.default !== true ||
    dispatch?.inputs?.dry_run?.required !== true ||
    !same(buildStep?.env, {
      SIMPROOF_DOCKER_GID: '0',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'release-build-placeholder',
      SIMPROOF_SESSION_SECRET: 'release-build-placeholder',
      SIMPROOF_RUNNER_TOKEN: 'release-build-placeholder',
      SIMPROOF_RUNNER_IMAGE:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      SIMPROOF_DOCKER_SOCKET: '/var/run/docker.sock',
    }) ||
    buildStep?.run !== 'docker compose --profile image-only build' ||
    release?.jobs?.['dry-run']?.permissions !== undefined
  ) {
    failures.push('Release permissions, inputs, or triggers are invalid.')
  }
}

async function validateIssueTemplates(root, failures) {
  const config = await yaml(root, '.github/ISSUE_TEMPLATE/config.yml', failures)
  if (!same(config, { blank_issues_enabled: false, contact_links: [] })) {
    failures.push('Issue-template configuration is invalid.')
  }
  for (const [name, expectedIds] of Object.entries(ISSUE_FIELDS)) {
    const template = await yaml(root, `.github/ISSUE_TEMPLATE/${name}.yml`, failures)
    const fields = template?.body?.filter((item) => item.type !== 'markdown') ?? []
    const ids = fields.map((item) => item.id)
    if (
      !same([...new Set(ids)], ids) ||
      expectedIds.some((id) => !ids.includes(id)) ||
      fields
        .filter((item) => expectedIds.includes(item.id) && item.type !== 'checkboxes')
        .some((item) => item.validations?.required !== true) ||
      !fields.some(
        (item) =>
          item.type === 'checkboxes' &&
          item.attributes?.options?.some((option) => option.required === true),
      )
    ) {
      failures.push(`${name} issue form is missing required structured fields.`)
    }
  }
  const security = await yaml(root, '.github/ISSUE_TEMPLATE/security.yml', failures)
  if (
    !Array.isArray(security?.body) ||
    security.body.length === 0 ||
    security.body.some((item) => item.type !== 'markdown') ||
    !security.body.some((item) => item.attributes?.value?.includes('SECURITY.md'))
  ) {
    failures.push('Security issue form must be a private-report redirect only.')
  }
}

async function yaml(root, path, failures) {
  const document = parseDocument(await readFile(resolve(root, path), 'utf8'), {
    version: '1.2',
    uniqueKeys: true,
    maxAliasCount: 0,
  })
  if (document.errors.length > 0) {
    failures.push(`${path} is invalid YAML.`)
    return undefined
  }
  return document.toJS({ maxAliasCount: 0 })
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
