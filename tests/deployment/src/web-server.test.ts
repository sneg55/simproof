import { createServer, request } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createWebServer, parseWebRequestLimit } from '../../../deployment/web-server.mjs'

const servers: import('node:http').Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await close(server)))
})

describe('web edge request boundary', () => {
  it('uses the application default and rejects invalid configured limits', () => {
    expect(parseWebRequestLimit({})).toBe(65_536)
    expect(parseWebRequestLimit({ SIMPROOF_MAX_REQUEST_BYTES: '16384' })).toBe(16_384)
    expect(parseWebRequestLimit({ SIMPROOF_MAX_REQUEST_BYTES: '1048576' })).toBe(1_048_576)
    for (const value of ['', '16383', '1048577', '65536.5', ' 65536']) {
      expect(() => parseWebRequestLimit({ SIMPROOF_MAX_REQUEST_BYTES: value })).toThrow(
        'Web request limit is invalid',
      )
    }
  })

  it('proxies a body above the old fixed limit and rejects a body above configuration', async () => {
    let upstreamCalls = 0
    const upstream = createServer((incoming, response) => {
      upstreamCalls += 1
      incoming.resume()
      incoming.once('end', () => {
        response.writeHead(204)
        response.end()
      })
    })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const edge = createWebServer({
      upstream: new URL(`http://127.0.0.1:${upstreamPort}`),
      maxRequestBodyBytes: 70_000,
    })
    servers.push(edge)
    const edgePort = await listen(edge)

    expect(await post(edgePort, 65_537)).toBe(204)
    expect(await post(edgePort, 70_001)).toBe(413)
    expect(upstreamCalls).toBe(1)
  })
})

async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('Server address is absent.')
  return address.port
}

async function close(server: import('node:http').Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error === undefined ? resolveClose() : reject(error)))
    server.closeAllConnections()
  })
}

async function post(port: number, bytes: number): Promise<number> {
  return await new Promise((resolveResponse, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/smoke',
        method: 'POST',
        headers: { 'content-length': String(bytes), 'content-type': 'application/json' },
      },
      (response) => {
        response.resume()
        response.once('end', () => resolveResponse(response.statusCode ?? 0))
      },
    )
    outgoing.once('error', reject)
    outgoing.end(Buffer.alloc(bytes, 0x20))
  })
}
