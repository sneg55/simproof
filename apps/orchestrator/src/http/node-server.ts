import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { correlationSchema } from '@simproof/observability'
import type { HttpRequest, HttpResponse } from './types.js'

interface HttpApi {
  handle(request: HttpRequest): Promise<HttpResponse>
}

export function createNodeHttpServer(
  api: HttpApi,
  options: { readonly createRequestId?: () => string } = {},
): Server {
  const server = createServer((request, response) => {
    void handleNodeRequest(
      api,
      nodeRequestToHttpRequest(request, options.createRequestId),
      request,
      response,
    )
  })
  server.maxHeadersCount = 100
  return server
}

export function nodeRequestToHttpRequest(
  request: IncomingMessage,
  createRequestId: () => string = randomUUID,
): HttpRequest {
  return {
    requestId: safeRequestId(createRequestId),
    method: request.method ?? '',
    path: request.url ?? '',
    headers: request.headers,
    body: request,
    peerAddress: request.socket.remoteAddress ?? 'unknown',
  }
}

async function handleNodeRequest(
  api: HttpApi,
  transported: HttpRequest,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const result = await api.handle(transported)
    request.resume()
    writeResponse(response, result)
  } catch {
    request.resume()
    writeResponse(response, {
      status: 500,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'x-simproof-request-id': transported.requestId ?? safeRequestId(randomUUID),
        'x-content-type-options': 'nosniff',
      },
      body: {
        ok: false,
        error: { id: 'http.internal-error', message: 'Request could not be completed.' },
      },
    })
  }
}

function writeResponse(response: ServerResponse, result: HttpResponse): void {
  if (response.headersSent || response.destroyed) return
  if (result.status === 204) {
    response.writeHead(result.status, result.headers)
    response.end()
    return
  }
  let body: string
  try {
    body = JSON.stringify(result.body)
  } catch {
    body = JSON.stringify({
      ok: false,
      error: { id: 'http.internal-error', message: 'Request could not be completed.' },
    })
    response.writeHead(500, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      ...(result.headers['access-control-expose-headers'] === undefined
        ? {}
        : {
            'access-control-expose-headers': result.headers['access-control-expose-headers'],
          }),
      ...(result.headers['x-simproof-request-id'] === undefined
        ? {}
        : { 'x-simproof-request-id': result.headers['x-simproof-request-id'] }),
      'x-content-type-options': 'nosniff',
    })
    response.end(body)
    return
  }
  response.writeHead(result.status, {
    ...result.headers,
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

function safeRequestId(createRequestId: () => string): string {
  try {
    const parsed = correlationSchema.safeParse({ requestId: createRequestId() })
    if (parsed.success && parsed.data.requestId !== undefined) return parsed.data.requestId
  } catch {
    // A server-owned fallback keeps the response correlatable when an injected source fails.
  }
  return randomUUID()
}
