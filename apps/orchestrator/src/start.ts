import { createApplication } from './application.js'
import { parseProcessEnvironment } from './config/environment.js'
import { createDemoGenerationOption } from './generation/demo-composition.js'
import { createProductionGenerationOption } from './generation/production-composition.js'
import { createNodeHttpServer } from './http/node-server.js'

const config = parseProcessEnvironment()
const educatorGeneration = config.demoGeneration
  ? createDemoGenerationOption()
  : createProductionGenerationOption(config)
const application = createApplication(
  config,
  educatorGeneration === undefined ? {} : { educatorGeneration },
)
const server = createNodeHttpServer(application.api)
const { host, port } = application.config.server ?? {
  host: application.config.deploymentMode === 'network' ? '0.0.0.0' : '127.0.0.1',
  port: 3_000,
}
let closing = false

function close(): void {
  if (closing) return
  closing = true
  server.close(() => {
    void application.close().catch(() => {
      process.exitCode = 1
    })
  })
  server.closeIdleConnections()
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
server.listen(port, host)
