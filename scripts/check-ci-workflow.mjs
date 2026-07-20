import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { parseDocument } from 'yaml'

const WORKFLOW_PATH = new URL('../.github/workflows/ci.yml', import.meta.url)

const ACTIONS = Object.freeze({
  checkout: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
  qemu: 'docker/setup-qemu-action@ce360397dd3f832beb865e1373c09c0e9f86d70a',
  node: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  cache: 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684',
})

const EXPECTED_STEP_NAMES = [
  'Check out repository',
  'Enable ARM64 runner security tests',
  'Set up Node.js',
  'Enable the locked pnpm release',
  'Locate the pnpm store',
  'Restore the content-addressed pnpm store',
  'Install locked dependencies',
  'Install the browser used by educator gates',
  'Run the authoritative repository gate',
  'Run educator browser journeys',
  'Run educator accessibility gate',
  'Validate the isolated runner image definition',
]

const EXPECTED_STEP_KEYS = [
  ['name', 'uses', 'with'],
  ['name', 'uses', 'with'],
  ['name', 'uses', 'with'],
  ['name', 'run'],
  ['name', 'id', 'shell', 'run'],
  ['name', 'uses', 'with'],
  ['name', 'run'],
  ['name', 'run'],
  ['name', 'run'],
  ['name', 'run'],
  ['name', 'run'],
  ['name', 'run'],
]

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const equalKeys = (value, expected) =>
  isRecord(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key))

const expectValue = (failures, actual, expected, description) => {
  if (actual !== expected) failures.push(`Invalid ${description}.`)
}

const validateTriggers = (failures, triggers) => {
  if (!equalKeys(triggers, ['push', 'pull_request', 'workflow_dispatch'])) {
    failures.push('Invalid workflow triggers.')
    return
  }

  if (!isRecord(triggers.push) || !equalKeys(triggers.push, ['branches'])) {
    failures.push('Push trigger must only declare its branch allowlist.')
  } else if (
    !Array.isArray(triggers.push.branches) ||
    triggers.push.branches.length !== 1 ||
    triggers.push.branches[0] !== 'main'
  ) {
    failures.push('Push trigger must target only main.')
  }
  expectValue(failures, triggers.pull_request, null, 'pull-request trigger')
  expectValue(failures, triggers.workflow_dispatch, null, 'manual trigger')
}

const validateAction = (failures, step, expected, description) => {
  if (!isRecord(step) || typeof step.uses !== 'string') {
    failures.push(`Missing ${description} action.`)
    return
  }
  if (!/@[a-f0-9]{40}$/u.test(step.uses)) {
    failures.push(`${description} action is not pinned to a full commit.`)
  }
  expectValue(failures, step.uses, expected, `${description} action`)
}

const validateSteps = (failures, steps) => {
  if (!Array.isArray(steps) || steps.length !== EXPECTED_STEP_NAMES.length) {
    failures.push('Verify job must contain the expected ordered steps.')
    return
  }

  steps.forEach((step, index) => {
    if (!isRecord(step)) {
      failures.push(`Step ${index + 1} must be a mapping.`)
      return
    }
    expectValue(failures, step.name, EXPECTED_STEP_NAMES[index], `name for step ${index + 1}`)
    if (!equalKeys(step, EXPECTED_STEP_KEYS[index])) {
      failures.push(`Step ${index + 1} contains unexpected configuration.`)
    }
  })

  const [
    checkout,
    qemu,
    node,
    corepack,
    store,
    cache,
    install,
    browser,
    check,
    browserJourneys,
    accessibility,
    docker,
  ] = steps
  validateAction(failures, checkout, ACTIONS.checkout, 'checkout')
  validateAction(failures, qemu, ACTIONS.qemu, 'QEMU setup')
  validateAction(failures, node, ACTIONS.node, 'Node setup')
  validateAction(failures, cache, ACTIONS.cache, 'pnpm cache')

  if (isRecord(checkout)) {
    if (!equalKeys(checkout.with, ['persist-credentials'])) {
      failures.push('Checkout inputs must only disable credential persistence.')
    } else {
      expectValue(
        failures,
        checkout.with['persist-credentials'],
        false,
        'checkout credential policy',
      )
    }
  }

  if (isRecord(qemu)) {
    if (!equalKeys(qemu.with, ['image', 'platforms'])) {
      failures.push('QEMU inputs must be the pinned image and platform scope.')
    } else {
      expectValue(
        failures,
        qemu.with.image,
        'tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0',
        'binfmt image',
      )
      expectValue(failures, qemu.with.platforms, 'arm64', 'QEMU platform scope')
    }
  }

  if (isRecord(node)) {
    if (!equalKeys(node.with, ['node-version', 'check-latest'])) {
      failures.push('Node setup inputs must pin the production release.')
    } else {
      expectValue(failures, node.with['node-version'], '24.15.0', 'Node release')
      expectValue(failures, node.with['check-latest'], false, 'Node release lookup policy')
    }
  }

  if (isRecord(store)) {
    expectValue(failures, store.id, 'pnpm-store', 'pnpm store step id')
    expectValue(failures, store.shell, 'bash', 'pnpm store shell')
  }

  if (isRecord(cache)) {
    if (!equalKeys(cache.with, ['path', 'key'])) {
      failures.push('Cache inputs must exclude partial restore keys.')
    } else {
      expectValue(
        failures,
        cache.with.path,
        '${{ steps.pnpm-store.outputs.path }}',
        'pnpm cache path',
      )
      expectValue(
        failures,
        cache.with.key,
        "pnpm-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}",
        'pnpm cache key',
      )
    }
  }

  expectValue(failures, corepack?.run, 'corepack enable', 'Corepack command')
  expectValue(
    failures,
    store?.run,
    'echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"',
    'pnpm store discovery command',
  )
  expectValue(failures, install?.run, 'pnpm install --frozen-lockfile', 'install command')
  expectValue(
    failures,
    browser?.run,
    'pnpm exec playwright install --with-deps chromium',
    'browser install command',
  )
  expectValue(failures, check?.run, 'pnpm check', 'repository check command')
  expectValue(failures, browserJourneys?.run, 'pnpm test:e2e', 'browser journey command')
  expectValue(failures, accessibility?.run, 'pnpm test:a11y', 'accessibility command')
  expectValue(
    failures,
    docker?.run,
    'docker build --check --file apps/runner/Dockerfile .',
    'runner definition command',
  )

  const allowedActions = new Set(Object.values(ACTIONS))
  for (const step of steps) {
    if (isRecord(step) && typeof step.uses === 'string' && !allowedActions.has(step.uses)) {
      failures.push(`Action is not allowlisted: ${step.uses}.`)
    }
  }
}

export const validateWorkflow = (source) => {
  const failures = []
  const document = parseDocument(source, {
    version: '1.2',
    uniqueKeys: true,
    prettyErrors: true,
  })
  if (document.errors.length > 0) {
    return document.errors.map((error) => `Invalid YAML: ${error.message}`)
  }

  let workflow
  try {
    workflow = document.toJS({ maxAliasCount: 0 })
  } catch (error) {
    return [`Invalid YAML graph: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!isRecord(workflow)) return ['Workflow root must be a mapping.']

  if (!equalKeys(workflow, ['name', 'on', 'permissions', 'concurrency', 'jobs'])) {
    failures.push('Workflow root contains unexpected configuration.')
  }
  expectValue(failures, workflow.name, 'CI', 'workflow name')

  validateTriggers(failures, workflow.on)

  if (!equalKeys(workflow.permissions, ['contents'])) {
    failures.push('Workflow permissions must only grant contents access.')
  } else {
    expectValue(failures, workflow.permissions.contents, 'read', 'workflow permissions')
  }

  if (!equalKeys(workflow.concurrency, ['group', 'cancel-in-progress'])) {
    failures.push('Workflow concurrency policy is invalid.')
  } else {
    expectValue(
      failures,
      workflow.concurrency.group,
      'ci-${{ github.workflow }}-${{ github.ref }}',
      'concurrency group',
    )
    expectValue(
      failures,
      workflow.concurrency['cancel-in-progress'],
      true,
      'concurrency cancellation policy',
    )
  }

  if (!equalKeys(workflow.jobs, ['verify']) || !isRecord(workflow.jobs.verify)) {
    failures.push('Workflow must define only the verify job.')
    return failures
  }
  const job = workflow.jobs.verify
  if (!equalKeys(job, ['name', 'runs-on', 'timeout-minutes', 'env', 'steps'])) {
    failures.push('Verify job contains unexpected configuration.')
  }
  expectValue(failures, job.name, 'Repository gate', 'verify job name')
  expectValue(failures, job['runs-on'], 'ubuntu-24.04', 'verify job runner')
  expectValue(failures, job['timeout-minutes'], 30, 'verify job timeout')

  if (!equalKeys(job.env, ['CI', 'OPENAI_API_KEY', 'CODEX_API_KEY'])) {
    failures.push('Verify job environment must contain only the approved values.')
  } else {
    expectValue(failures, job.env.CI, 'true', 'CI environment value')
    expectValue(failures, job.env.OPENAI_API_KEY, '', 'OpenAI credential boundary')
    expectValue(failures, job.env.CODEX_API_KEY, '', 'Codex credential boundary')
  }

  validateSteps(failures, job.steps)

  if (JSON.stringify(workflow).includes('${{ secrets.')) {
    failures.push('Workflow must not interpolate repository secrets.')
  }

  return failures
}

const run = async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8')
  const failures = validateWorkflow(source)
  if (failures.length > 0) {
    throw new Error(`CI workflow contract failed:\n${failures.join('\n')}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run()
