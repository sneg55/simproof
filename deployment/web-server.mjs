import { createReadStream, statSync } from 'node:fs'
import { createServer, request as createUpstreamRequest } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultPublicRoot = '/app/public'
const upstreamTimeoutMs = 15_000
const defaultMaxRequestBodyBytes = 65_536
const minimumRequestBodyBytes = 16_384
const maximumRequestBodyBytes = 1_048_576
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const mediaTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

export function parseWebRequestLimit(environment = process.env) {
  const raw = environment.SIMPROOF_MAX_REQUEST_BYTES ?? String(defaultMaxRequestBodyBytes)
  if (!/^\d{1,7}$/u.test(raw)) throw new Error('Web request limit is invalid.')
  const value = Number(raw)
  if (value < minimumRequestBodyBytes || value > maximumRequestBodyBytes) {
    throw new Error('Web request limit is invalid.')
  }
  return value
}

export function createWebServer(options = {}) {
  const publicRoot = options.publicRoot ?? defaultPublicRoot
  const upstream =
    options.upstream ?? new URL(process.env.SIMPROOF_ORCHESTRATOR_URL ?? 'http://orchestrator:3000')
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? parseWebRequestLimit()
  const server = createServer((request, response) => {
    const target = safeTarget(request.url)
    if (target === undefined) {
      respond(response, 400, 'text/plain; charset=utf-8', 'Bad request.\n')
      return
    }
    if (target.pathname === '/healthz') {
      respond(response, 200, 'application/json; charset=utf-8', '{"status":"live"}\n')
      return
    }
    if (target.pathname === '/readyz' || target.pathname.startsWith('/api/')) {
      proxy(
        request,
        response,
        upstream,
        maxRequestBodyBytes,
        target.pathname === '/readyz' ? '/ready' : undefined,
      )
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respond(response, 405, 'text/plain; charset=utf-8', 'Method not allowed.\n')
      return
    }
    serveStatic(request.method, target.pathname, response, publicRoot)
  })
  server.maxHeadersCount = 100
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    else socket.destroy()
  })
  return server
}

function safeTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 8_192) return undefined
  try {
    return new URL(raw, 'http://simproof.invalid')
  } catch {
    return undefined
  }
}

function proxy(request, response, upstream, maxRequestBodyBytes, upstreamPath) {
  const target = safeTarget(request.url)
  if (target === undefined) {
    respond(response, 400, 'text/plain; charset=utf-8', 'Bad request.\n')
    return
  }
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    respond(response, 413, 'text/plain; charset=utf-8', 'Request body too large.\n')
    request.resume()
    return
  }
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      ([name]) => !hopByHopHeaders.has(name) && !name.startsWith('x-forwarded-'),
    ),
  )
  headers.host = upstream.host
  const upstreamRequest = createUpstreamRequest(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: `${upstreamPath ?? target.pathname}${target.search}`,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = Object.fromEntries(
        Object.entries(upstreamResponse.headers).filter(([name]) => !hopByHopHeaders.has(name)),
      )
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(response)
    },
  )
  upstreamRequest.setTimeout(upstreamTimeoutMs, () => upstreamRequest.destroy())
  request.once('aborted', () => upstreamRequest.destroy())
  response.once('close', () => {
    if (!response.writableEnded) upstreamRequest.destroy()
  })
  upstreamRequest.on('error', () => {
    if (!response.headersSent) respond(response, 502, 'text/plain; charset=utf-8', 'Unavailable.\n')
    else response.destroy()
  })
  let requestBodyBytes = 0
  request.on('data', (chunk) => {
    requestBodyBytes += chunk.length
    if (requestBodyBytes <= maxRequestBodyBytes) return
    request.unpipe(upstreamRequest)
    upstreamRequest.destroy()
    request.resume()
    if (!response.headersSent) {
      respond(response, 413, 'text/plain; charset=utf-8', 'Request body too large.\n')
    }
  })
  request.pipe(upstreamRequest)
}

function serveStatic(method, pathname, response, publicRoot) {
  const candidate = staticPath(pathname, publicRoot)
  if (candidate === undefined) {
    respond(response, 404, 'text/plain; charset=utf-8', 'Not found.\n')
    return
  }
  let selected = candidate
  try {
    if (!statSync(selected).isFile()) selected = resolve(publicRoot, 'index.html')
  } catch {
    selected = resolve(publicRoot, 'index.html')
  }
  const metadata = statSync(selected)
  const headers = {
    'cache-control': selected.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'content-length': String(metadata.size),
    'content-security-policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': mediaTypes.get(extname(selected)) ?? 'application/octet-stream',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
  response.writeHead(200, headers)
  if (method === 'HEAD') response.end()
  else createReadStream(selected).pipe(response)
}

function staticPath(pathname, publicRoot) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  const selected = resolve(publicRoot, `.${decoded === '/' ? '/index.html' : decoded}`)
  return selected.startsWith(`${publicRoot}${sep}`) ? selected : undefined
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  createWebServer().listen(8080, '0.0.0.0')
}

function respond(response, status, contentType, body) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}
