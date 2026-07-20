import { isIP } from 'node:net'

export function parseAllowedOrigins(
  value: string,
  requireHttps: boolean,
): readonly string[] | undefined {
  const origins = value.split(',').map((origin) => origin.trim())
  if (origins.length === 0 || origins.length > 8 || new Set(origins).size !== origins.length) {
    return undefined
  }
  try {
    return origins.every((origin) => {
      const url = new URL(origin)
      return (
        origin === url.origin &&
        url.username === '' &&
        url.password === '' &&
        (url.protocol === 'https:' || (!requireHttps && url.protocol === 'http:'))
      )
    })
      ? origins
      : undefined
  } catch {
    return undefined
  }
}

export function validExternalEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function validTrustedProxy(value: string): boolean {
  return isIP(value) !== 0 && value !== '0.0.0.0' && value !== '::'
}
