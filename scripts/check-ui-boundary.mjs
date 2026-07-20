import { readFile } from 'node:fs/promises'

import { ESLint } from 'eslint'

const eslint = new ESLint()
const fixtureRoot = new URL('../tests/fixtures/ui-boundary/', import.meta.url)
const boundaryRuleIds = new Set(['no-restricted-imports', 'no-restricted-syntax'])
const primitiveImportGuidance =
  'Import the corresponding shadcn component from @/components/ui. Direct primitive-library imports belong only in components/ui.'

const deniedCases = [
  {
    fixture: 'invalid/raw-controls.txt',
    filePath: 'apps/web/src/features/raw-controls.jsx',
    expectedViolations: [
      [
        'no-restricted-syntax',
        'Do not hand-roll <button> in feature code. Use Button from @/components/ui/button.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <input> in feature code. Use Input from @/components/ui/input.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <select> in feature code. Use Select from @/components/ui/select.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <textarea> in feature code. Use Textarea from @/components/ui/textarea.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <dialog> in feature code. Use Dialog from @/components/ui/dialog.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <table> in feature code. Use Table from @/components/ui/table.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <label> in feature code. Use Label or Field from @/components/ui.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <progress> in feature code. Use Progress from @/components/ui/progress.',
      ],
      [
        'no-restricted-syntax',
        'Do not hand-roll <hr> in feature code. Use Separator from @/components/ui/separator.',
      ],
    ],
  },
  {
    fixture: 'invalid/direct-primitive-imports.txt',
    filePath: 'apps/web/src/features/direct-primitive-imports.jsx',
    expectedViolations: [
      '@radix-ui/react-dialog',
      'radix-ui',
      '@base-ui/react/dialog',
      '@headlessui/react',
    ].map((source) => [
      'no-restricted-imports',
      `'${source}' import is restricted from being used by a pattern. ${primitiveImportGuidance}`,
    ]),
  },
]

const allowedCases = [
  {
    fixture: 'valid/reviewed-primitive.txt',
    filePath: 'apps/web/src/components/ui/reviewed-primitive.jsx',
  },
  {
    fixture: 'valid/semantic-content.txt',
    filePath: 'apps/web/src/features/semantic-content.jsx',
  },
]

const failures = []

const normalizeViolations = (messages) =>
  messages
    .filter(({ ruleId }) => boundaryRuleIds.has(ruleId ?? ''))
    .map(({ ruleId, message }) => `${ruleId}: ${message}`)
    .sort()

const readFixture = async (fixture) =>
  await readFile(new URL(fixture, fixtureRoot), { encoding: 'utf8' })

for (const testCase of deniedCases) {
  const source = await readFixture(testCase.fixture)
  const [result] = await eslint.lintText(source, { filePath: testCase.filePath })
  const actual = normalizeViolations(result.messages)
  const expected = testCase.expectedViolations
    .map(([ruleId, message]) => `${ruleId}: ${message}`)
    .sort()

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `Expected ${testCase.fixture} at ${testCase.filePath} to report:\n${expected.join('\n')}\nReceived:\n${actual.join('\n')}`,
    )
  }
}

for (const testCase of allowedCases) {
  const source = await readFixture(testCase.fixture)
  const [result] = await eslint.lintText(source, { filePath: testCase.filePath })
  const violations = normalizeViolations(result.messages)
  const infrastructureMessages = result.messages.filter(
    ({ fatal, ruleId, message }) =>
      fatal === true ||
      (ruleId === null && /ignored|matching configuration|parsing error/iu.test(message)),
  )

  if (violations.length > 0 || infrastructureMessages.length > 0) {
    failures.push(
      `Expected ${testCase.fixture} at ${testCase.filePath} to pass the UI boundary:\n${[
        ...violations,
        ...infrastructureMessages.map(({ message }) => message),
      ].join('\n')}`,
    )
  }
}

if (failures.length > 0) {
  throw new Error(`UI boundary self-check failed:\n${failures.join('\n\n')}`)
}
