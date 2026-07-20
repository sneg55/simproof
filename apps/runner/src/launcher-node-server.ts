import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { MAX_RUNNER_LAUNCHER_REQUEST_BYTES } from '@simproof/contracts'

import type { LauncherControlPlane, LauncherControlResponse } from './launcher-control-plane.js'

export interface LauncherNodeServerOptions {
  readonly maxRequestBytes: number
}

function send(response: ServerResponse, output: LauncherControlResponse): void {
  if (response.writableEnded) return
  response.statusCode = output.status
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  if (output.status === 413) response.setHeader('connection', 'close')
  response.end(JSON.stringify(output.body))
}

async function readBody(
  request: IncomingMessage,
  maximum: number,
): Promise<{ readonly body: string; readonly tooLarge: boolean }> {
  const length = request.headers['content-length']
  if (typeof length === 'string' && (!/^\d+$/u.test(length) || Number(length) > maximum)) {
    request.resume()
    return { body: '', tooLarge: true }
  }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += bytes.byteLength
      if (total > maximum) {
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) chunks.push(bytes)
    })
    request.once('end', () =>
      resolve({ body: tooLarge ? '' : Buffer.concat(chunks, total).toString('utf8'), tooLarge }),
    )
    request.once('error', reject)
    request.once('aborted', () => reject(new TypeError('Launcher request aborted.')))
  })
}

export async function handleLauncherNodeRequest(
  plane: LauncherControlPlane,
  maximum: number,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const cancellation = new AbortController()
  let completed = false
  const abort = () => {
    if (!completed) cancellation.abort()
  }
  request.once('aborted', abort)
  response.once('close', abort)
  try {
    const path = exactRequestPath(request.url)
    if (path === undefined) {
      send(response, { status: 400, body: { errorId: 'launcher.invalid-request' } })
      completed = true
      return
    }
    const body = await readBody(request, maximum)
    const authorization = request.headers.authorization
    const output = await plane.handle({
      method: request.method ?? '',
      path,
      ...(typeof authorization === 'string' ? { authorization } : {}),
      body: body.body,
      ...(body.tooLarge ? { bodyTooLarge: true as const } : {}),
      signal: cancellation.signal,
    })
    completed = true
    send(response, output)
  } catch {
    completed = true
    if (!response.writableEnded) {
      response.statusCode = 500
      response.setHeader('cache-control', 'no-store')
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ errorId: 'launcher.unavailable' }))
    }
  } finally {
    request.removeListener('aborted', abort)
    response.removeListener('close', abort)
  }
}

function exactRequestPath(target: string | undefined): string | undefined {
  if (target === undefined || !target.startsWith('/')) return undefined
  try {
    const parsed = new URL(target, 'http://launcher.invalid')
    return parsed.origin === 'http://launcher.invalid' && target === parsed.pathname
      ? parsed.pathname
      : undefined
  } catch {
    return undefined
  }
}

export function createLauncherNodeServer(
  plane: LauncherControlPlane,
  options: LauncherNodeServerOptions,
): Server {
  if (
    !Number.isInteger(options.maxRequestBytes) ||
    options.maxRequestBytes < 16_384 ||
    options.maxRequestBytes > MAX_RUNNER_LAUNCHER_REQUEST_BYTES
  ) {
    throw new TypeError('Launcher request limit must be bounded.')
  }
  const server = createServer(
    {
      maxHeaderSize: 8_192,
      requestTimeout: 10_000,
      headersTimeout: 5_000,
      keepAliveTimeout: 5_000,
    },
    (request, response) => {
      void handleLauncherNodeRequest(plane, options.maxRequestBytes, request, response)
    },
  )
  server.maxHeadersCount = 32
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    else socket.destroy()
  })
  return server
}
