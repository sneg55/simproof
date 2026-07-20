import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { LauncherControlPlane } from './launcher-control-plane.js'
import { createLauncherNodeServer, handleLauncherNodeRequest } from './launcher-node-server.js'

class ResponseFixture extends EventEmitter {
  statusCode = 0
  writableEnded = false
  readonly headers = new Map<string, string>()
  output = ''

  setHeader(name: string, value: string): void {
    this.headers.set(name, value)
  }

  end(value = ''): void {
    this.output = value
    this.writableEnded = true
  }
}

function request(chunks: readonly string[]): IncomingMessage {
  const stream = Readable.from(chunks) as IncomingMessage
  stream.method = 'POST'
  stream.url = '/v1/execute'
  stream.headers = { authorization: 'Bearer secret' }
  return stream
}

describe('launcher Node HTTP boundary', () => {
  it('enforces the body cap while streaming before control-plane parsing', async () => {
    const handle = vi.fn<LauncherControlPlane['handle']>().mockResolvedValue({
      status: 413,
      body: { errorId: 'launcher.request-too-large' },
    })
    const response = new ResponseFixture()
    await handleLauncherNodeRequest(
      { handle },
      16_384,
      request(['x'.repeat(10_000), 'y'.repeat(10_000), 'not-materialized']),
      response as unknown as ServerResponse,
    )
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: '', bodyTooLarge: true }))
    expect(response.statusCode).toBe(413)
    expect(response.headers.get('connection')).toBe('close')
  })

  it('rejects an oversized Content-Length before receiving or allocating its body', async () => {
    const handle = vi.fn<LauncherControlPlane['handle']>().mockResolvedValue({
      status: 413,
      body: { errorId: 'launcher.request-too-large' },
    })
    const input = request([])
    input.headers['content-length'] = '20000'
    const response = new ResponseFixture()
    await handleLauncherNodeRequest(
      { handle },
      16_384,
      input,
      response as unknown as ServerResponse,
    )
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: '', bodyTooLarge: true }))
    expect(response.headers.get('connection')).toBe('close')
  })

  it('sets bounded parser and connection controls', () => {
    const server = createLauncherNodeServer({ handle: vi.fn() }, { maxRequestBytes: 16_384 })
    expect(server.maxHeadersCount).toBe(32)
    expect(server.requestTimeout).toBe(10_000)
    expect(server.headersTimeout).toBe(5_000)
    expect(server.keepAliveTimeout).toBe(5_000)
    server.close()
  })

  it('rejects a server above the shared body ceiling', () => {
    expect(() =>
      createLauncherNodeServer({ handle: vi.fn() }, { maxRequestBytes: 1_048_577 }),
    ).toThrowError(/request limit/u)
  })

  it('aborts in-flight execution when the client disconnects', async () => {
    let observed: AbortSignal | undefined
    const handle = vi.fn<LauncherControlPlane['handle']>().mockImplementation(
      (input) =>
        new Promise((resolve) => {
          observed = input.signal
          input.signal?.addEventListener(
            'abort',
            () => resolve({ status: 200, body: { status: 'ok' } }),
            { once: true },
          )
        }),
    )
    const response = new ResponseFixture()
    const pending = handleLauncherNodeRequest(
      { handle },
      16_384,
      request(['{}']),
      response as unknown as ServerResponse,
    )
    await vi.waitFor(() => expect(observed).toBeDefined())
    response.emit('close')
    await pending
    expect(observed?.aborted).toBe(true)
  })

  it.each([
    '/v1/execute?probe=true',
    '/healthz#fragment',
    'http://user:password@launcher.invalid/v1/execute',
    '//launcher.invalid/v1/execute',
  ])('rejects a non-exact request target %s before dispatch', async (target) => {
    const handle = vi.fn<LauncherControlPlane['handle']>()
    const input = request([])
    input.url = target
    const response = new ResponseFixture()
    await handleLauncherNodeRequest(
      { handle },
      16_384,
      input,
      response as unknown as ServerResponse,
    )
    expect(handle).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(400)
    expect(response.output).toBe('{"errorId":"launcher.invalid-request"}')
  })
})
