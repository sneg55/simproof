import js from '@eslint/js'
import comments from 'eslint-plugin-eslint-comments'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import security from 'eslint-plugin-security'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const typescriptFiles = ['**/*.{ts,tsx}']
const testFiles = ['**/*.{test,spec}.{ts,tsx}', '**/tests/**/*.{ts,tsx}']
const simulationCoreFiles = [
  'packages/sim-runtime/src/**/*.{ts,tsx}',
  '**/{generated-cores,simulation-cores}/**/*.{ts,tsx}',
  '**/*.{generated-core,simulation-core,core-adapter}.{ts,tsx}',
]
const rawErrorRestriction = {
  selector: 'ThrowStatement > NewExpression[callee.name="Error"]',
  message:
    'Return Result<T, AppError> for operational failures. Use an identified AppError for invariant failures.',
}
const restrictedUiElements = [
  ['button', 'Button from @/components/ui/button'],
  ['input', 'Input from @/components/ui/input'],
  ['select', 'Select from @/components/ui/select'],
  ['textarea', 'Textarea from @/components/ui/textarea'],
  ['dialog', 'Dialog from @/components/ui/dialog'],
  ['table', 'Table from @/components/ui/table'],
  ['label', 'Label or Field from @/components/ui'],
  ['progress', 'Progress from @/components/ui/progress'],
  ['hr', 'Separator from @/components/ui/separator'],
].map(([element, replacement]) => ({
  selector: `JSXOpeningElement[name.name="${element}"]`,
  message: `Do not hand-roll <${element}> in feature code. Use ${replacement}.`,
}))

export default tseslint.config(
  {
    ignores: ['.claude/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      'eslint-comments': comments,
      'react-hooks': reactHooks,
      security,
      sonarjs,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json', 'tsconfig.json'],
        },
      },
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,

      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowNullableBoolean: true, allowNullableObject: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      'eslint-comments/no-unlimited-disable': 'error',
      'eslint-comments/no-unused-disable': 'error',
      'eslint-comments/require-description': 'error',

      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-cycle': ['error', { maxDepth: 10 }],
      'import/no-extraneous-dependencies': 'error',
      'import/no-self-import': 'error',
      'import/no-unresolved': 'error',

      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': ['error', { patterns: ['../../../*'] }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read and validate environment variables only in an env boundary module.',
        },
      ],
      'no-restricted-syntax': ['error', rawErrorRestriction],
      'no-warning-comments': ['warn', { terms: ['fixme', 'xxx', 'hack'], location: 'anywhere' }],

      'security/detect-child-process': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-object-injection': 'warn',
      'security/detect-unsafe-regex': 'error',

      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/prefer-immediate-return': 'error',

      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 3],
      'max-params': ['warn', 4],

      // Biome owns these rules so they do not fire twice.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/{env,environment}.{ts,tsx}'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    files: simulationCoreFiles,
    ignores: ['packages/sim-runtime/src/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Simulation cores cannot access the host process.' },
        { name: 'globalThis', message: 'Simulation cores cannot access host globals.' },
        { name: 'Date', message: 'Simulation cores cannot access the clock.' },
        { name: 'performance', message: 'Simulation cores cannot access the clock.' },
        { name: 'Temporal', message: 'Simulation cores cannot access the clock.' },
        { name: 'crypto', message: 'Simulation cores cannot access host randomness.' },
        { name: 'fetch', message: 'Simulation cores cannot access the network.' },
        { name: 'WebSocket', message: 'Simulation cores cannot access the network.' },
        { name: 'XMLHttpRequest', message: 'Simulation cores cannot access the network.' },
        { name: 'EventSource', message: 'Simulation cores cannot access the network.' },
        { name: 'navigator', message: 'Simulation cores cannot access host networking APIs.' },
        { name: 'setTimeout', message: 'Simulation cores cannot access host timers.' },
        { name: 'setInterval', message: 'Simulation cores cannot access host timers.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Simulation cores must be deterministic and cannot use randomness.',
        },
        {
          object: 'process',
          property: 'env',
          message: 'Simulation cores cannot read the host environment.',
        },
        {
          object: 'Deno',
          property: 'env',
          message: 'Simulation cores cannot read the host environment.',
        },
        {
          object: 'Bun',
          property: 'env',
          message: 'Simulation cores cannot read the host environment.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'assert',
                'assert/*',
                'async_hooks',
                'buffer',
                'child_process',
                'cluster',
                'console',
                'constants',
                'crypto',
                'dgram',
                'diagnostics_channel',
                'dns',
                'dns/*',
                'domain',
                'events',
                'fs',
                'fs/*',
                'http',
                'http/*',
                'http2',
                'https',
                'module',
                'net',
                'os',
                'path',
                'path/*',
                'perf_hooks',
                'process',
                'punycode',
                'querystring',
                'readline',
                'readline/*',
                'repl',
                'stream',
                'stream/*',
                'string_decoder',
                'sys',
                'timers',
                'timers/*',
                'tls',
                'trace_events',
                'tty',
                'url',
                'util',
                'util/*',
                'v8',
                'vm',
                'wasi',
                'worker_threads',
                'zlib',
              ],
              message: 'The simulation-core boundary must remain host-independent and DOM-free.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        rawErrorRestriction,
        {
          selector: 'MemberExpression[object.type="MetaProperty"][property.name="env"]',
          message: 'Simulation cores cannot read build-tool or host environment variables.',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{jsx,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ['apps/web/src/**/*.{jsx,tsx}'],
    ignores: ['apps/web/src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../*'],
              message: 'Import through the owning package or its public entry point.',
            },
            {
              group: ['@radix-ui/*', 'radix-ui', '@base-ui/*', '@headlessui/*'],
              message:
                'Import the corresponding shadcn component from @/components/ui. Direct primitive-library imports belong only in components/ui.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', rawErrorRestriction, ...restrictedUiElements],
    },
  },
  {
    files: testFiles,
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'max-nested-callbacks': 'off',
      'no-restricted-syntax': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  {
    files: ['tests/deployment/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../../*'],
              message: 'Deployment tests may import repository-owned deployment boundaries only.',
            },
          ],
        },
      ],
    },
  },
)
