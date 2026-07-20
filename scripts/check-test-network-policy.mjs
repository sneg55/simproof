import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preload = resolve(root, 'scripts/deny-test-network.cjs')
const probe = spawnSync(
  process.execPath,
  [
    '--eval',
    `const dgram = require('node:dgram')
const dns = require('node:dns')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

function isPolicyDenial(error) {
  if (error?.code === 'SIMPROOF_TEST_NETWORK_DISABLED') return true
  if (Array.isArray(error?.errors) && error.errors.some(isPolicyDenial)) return true
  return error?.cause !== undefined && isPolicyDenial(error.cause)
}

async function expectDenied(operation) {
  try {
    await operation()
  } catch (error) {
    if (isPolicyDenial(error)) return
    throw error
  }
  throw new Error('An external network operation was not denied.')
}

async function verifyDenials() {
  await expectDenied(
    () => new Promise((resolve, reject) => {
      const socket = net.connect(443, 'example.com', resolve)
      socket.once('error', reject)
    }),
  )
  await expectDenied(
    () => new Promise((resolve, reject) => {
      dgram.createSocket('udp4').send('probe', 53, '8.8.8.8', (error) =>
        error === null ? resolve() : reject(error),
      )
    }),
  )
  await expectDenied(
    () => new Promise((resolve, reject) => {
      dgram.createSocket('udp4').connect(53, '8.8.8.8', (error) =>
        error === undefined ? resolve() : reject(error),
      )
    }),
  )
  await expectDenied(
    () => new Promise((resolve, reject) => {
      dns.resolve4('example.com', (error) => (error === null ? resolve() : reject(error)))
    }),
  )
  await expectDenied(() => dns.promises.resolve4('example.com'))
  await expectDenied(
    () => new Promise((resolve, reject) => {
      new dns.Resolver().resolve4('example.com', (error) =>
        error === null ? resolve() : reject(error),
      )
    }),
  )
  await expectDenied(() => new dns.promises.Resolver().resolve4('example.com'))
  await expectDenied(() => fetch('https://example.com'))
}

async function verifyTcpLoopback() {
  const server = net.createServer((socket) => socket.end())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('Missing TCP address.')
    await new Promise((resolve, reject) => {
      const socket = net.connect(address.port, '127.0.0.1', resolve)
      socket.once('error', reject)
      socket.once('close', resolve)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function verifyUdpLoopback() {
  const receiver = dgram.createSocket('udp4')
  const sender = dgram.createSocket('udp4')
  await new Promise((resolve, reject) => {
    receiver.once('error', reject)
    receiver.bind(0, '127.0.0.1', resolve)
  })
  try {
    const address = receiver.address()
    const received = new Promise((resolve, reject) => {
      receiver.once('message', resolve)
      receiver.once('error', reject)
    })
    await new Promise((resolve, reject) => {
      sender.send('probe', address.port, '127.0.0.1', (error) =>
        error === null ? resolve() : reject(error),
      )
    })
    await received
  } finally {
    receiver.close()
    sender.close()
  }
}

async function verifyUnixSocket() {
  const socketPath = path.join(os.tmpdir(), 'simproof-network-policy-' + process.pid + '.sock')
  fs.rmSync(socketPath, { force: true })
  const server = net.createServer((socket) => socket.end())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect(socketPath, resolve)
      socket.once('error', reject)
      socket.once('close', resolve)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(socketPath, { force: true })
  }
}

async function verifyScopedIpv6Loopback() {
  await new Promise((resolve, reject) => {
    dns.lookup('::1%lo0', (error) =>
      isPolicyDenial(error) ? reject(error) : resolve(),
    )
  })
  await dns.promises.lookup('::1%lo0').catch((error) => {
    if (isPolicyDenial(error)) throw error
  })
}

void (async () => {
  await verifyDenials()
  await verifyTcpLoopback()
  await verifyUdpLoopback()
  await verifyUnixSocket()
  await verifyScopedIpv6Loopback()
})().catch((error) => {
  process.stderr.write(String(error?.stack ?? error))
  process.exitCode = 1
})`,
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: withNetworkPolicy(process.env.NODE_OPTIONS) },
  },
)

if (probe.error !== undefined) throw probe.error
if (probe.status !== 0 || probe.stdout !== '' || probe.stderr !== '') {
  throw new Error(`Automated test network policy is not enforced: ${probe.stderr}`)
}

function withNetworkPolicy(current) {
  const option = `--require=${preload}`
  return current === undefined || current.trim() === '' ? option : `${current} ${option}`
}
