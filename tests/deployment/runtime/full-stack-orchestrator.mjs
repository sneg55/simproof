import { prepareCodexRoots, validateConfiguredCodexRoots } from '/app/deployment/codex-roots.mjs'
import { withExclusiveLease } from '/app/deployment/recovery.mjs'
import { createApplication } from '/app/dist/application.js'
import { parseProcessEnvironment } from '/app/dist/config/environment.js'
import { createProductionGenerationOption } from '/app/dist/generation/production-composition.js'
import { createNodeHttpServer } from '/app/dist/http/node-server.js'
import {
  createScriptedFakeProvider,
  fakeProviderScenarios,
} from '/app/node_modules/@simproof/providers/dist/index.js'

const operationRoot = '/var/lib/simproof'
const originalFetch = globalThis.fetch
let providerNetworkAttempts = 0
let runnerRequests = 0

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = String(
    init?.method ?? (input instanceof Request ? input.method : 'GET'),
  ).toUpperCase()
  if (
    url.protocol === 'http:' &&
    url.hostname === 'runner-launcher' &&
    url.port === '4318' &&
    ((method === 'GET' && url.pathname === '/v1/capabilities') ||
      (method === 'POST' && url.pathname === '/v1/execute')) &&
    url.search === '' &&
    url.hash === ''
  ) {
    runnerRequests += 1
    return await originalFetch(input, init)
  }
  providerNetworkAttempts += 1
  throw new Error('Deployment smoke blocked an unexpected network request.')
}

validateConfiguredCodexRoots()
await prepareCodexRoots()

await withExclusiveLease(operationRoot, async () => {
  const config = parseProcessEnvironment()
  const conceptCompiler = createScriptedFakeProvider(fakeProviderScenarios.correct)
  const codeGenerator = createScriptedFakeProvider(fakeProviderScenarios.correct)
  const educatorGeneration = createProductionGenerationOption(config, {
    createConceptCompiler: () => conceptCompiler,
    createCodeGenerator: () => codeGenerator,
  })
  if (educatorGeneration === undefined) throw new Error('Deployment smoke generation is absent.')

  const application = createApplication(config, { educatorGeneration })
  const api = {
    handle: async (request) => {
      if (request.method === 'GET' && request.path === '/api/__smoke/status') {
        return {
          status: 200,
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
          body: { providerNetworkAttempts, runnerRequests },
        }
      }
      return await application.api.handle(request)
    },
  }
  const server = createNodeHttpServer(api)
  const { host, port } = config.server ?? { host: '0.0.0.0', port: 3_000 }

  await new Promise((resolve, reject) => {
    let closing = false
    const close = () => {
      if (closing) return
      closing = true
      server.close(() => {
        void application.close().then(resolve, reject)
      })
      server.closeIdleConnections()
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    server.once('error', reject)
    server.listen(port, host)
  })
})
