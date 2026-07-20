import { createDockerLauncherRuntime } from './docker-runtime.js'
import { parseLauncherProcessEnvironment } from './environment.js'
import { createLauncherControlPlane } from './launcher-control-plane.js'
import { createLauncherNodeServer } from './launcher-node-server.js'

const config = parseLauncherProcessEnvironment()
const runtime = createDockerLauncherRuntime(config.image)
await runtime.initialize()
const plane = createLauncherControlPlane({
  token: config.token,
  image: config.image,
  maxRequestBytes: config.maxRequestBytes,
  maxConcurrent: config.maxConcurrent,
  maximumLimits: config.maximumLimits,
  launcher: runtime,
  readiness: runtime.readiness,
})
const server = createLauncherNodeServer(plane, { maxRequestBytes: config.maxRequestBytes })
let closing = false

async function close(): Promise<void> {
  if (closing) return
  closing = true
  server.close(() => undefined)
  server.closeIdleConnections()
  if (!(await runtime.close())) process.exitCode = 1
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
server.listen(config.listen.port, config.listen.host)
