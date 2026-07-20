import { isIP } from 'node:net'

import { parseStrictJson } from './strict-json.js'
import type { HttpRequest } from './types.js'

export class RequestError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly id: string,
  ) {
    super(id)
    this.name = 'RequestError'
  }
}

export function normalizeHeaders(input: HttpRequest['headers']): ReadonlyMap<string, string> {
  const headers = new Map<string, string>()
  for (const [rawName, rawValue] of Object.entries(input)) {
    if (rawValue === undefined || Array.isArray(rawValue))
      throw new RequestError(400, 'http.headers')
    const name = rawName.toLowerCase()
    if (headers.has(name) || /[^!#$%&'*+.^_`|~\da-z-]/u.test(name)) {
      throw new RequestError(400, 'http.headers')
    }
    headers.set(name, rawValue as string)
  }
  return headers
}

export async function readJsonBody(
  body: HttpRequest['body'],
  headers: ReadonlyMap<string, string>,
  maximumBytes: number,
): Promise<unknown> {
  if (headers.get('content-type') !== 'application/json') {
    throw new RequestError(415, 'http.content-type')
  }
  if (headers.has('content-encoding')) throw new RequestError(415, 'http.content-encoding')
  const declaredLength = declaredBodyLength(headers.get('content-length'), maximumBytes)
  const bytes = await collectBody(body, maximumBytes)
  if (declaredLength !== undefined && declaredLength !== bytes.byteLength) {
    throw new RequestError(400, 'http.content-length')
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return parseStrictJson(text)
  } catch {
    throw new RequestError(400, 'http.json')
  }
}

export function sessionCookie(header: string | undefined, secure: boolean): string | undefined {
  if (header === undefined || header.length > 4_096) return undefined
  const expectedName = secure ? '__Host-simproof_session' : 'simproof_session'
  const cookies = new Map<string, string>()
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) return undefined
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (cookies.has(name)) return undefined
    cookies.set(name, value)
  }
  return cookies.get(expectedName)
}

export function forwardedSource(headers: ReadonlyMap<string, string>): string | undefined {
  const value = headers.get('x-forwarded-for')
  return value !== undefined && isIP(value) !== 0 ? value : undefined
}

function declaredBodyLength(value: string | undefined, maximumBytes: number): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d{1,10}$/u.test(value)) throw new RequestError(400, 'http.content-length')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new RequestError(400, 'http.content-length')
  if (length > maximumBytes) throw new RequestError(413, 'http.body-too-large')
  return length
}

async function collectBody(body: HttpRequest['body'], maximumBytes: number): Promise<Uint8Array> {
  if (body === undefined) return new Uint8Array()
  if (body instanceof Uint8Array) {
    if (body.byteLength > maximumBytes) throw new RequestError(413, 'http.body-too-large')
    return body
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) throw new RequestError(400, 'http.body')
    total += chunk.byteLength
    if (total > maximumBytes) throw new RequestError(413, 'http.body-too-large')
    chunks.push(chunk)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
