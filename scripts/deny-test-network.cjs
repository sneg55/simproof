'use strict'

const net = require('node:net')
const dgram = require('node:dgram')
const dns = require('node:dns')

const originalConnect = net.Socket.prototype.connect
const originalDatagramConnect = dgram.Socket.prototype.connect
const originalSend = dgram.Socket.prototype.send
const loopback =
  /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|\[?::1(?:%[\w.~-]+)?\]?|::ffff:127(?:\.\d{1,3}){3}(?:%[\w.~-]+)?)$/iu

const endpointHost = (args) => {
  const first = args[0]
  if (Array.isArray(first)) return endpointHost(first)
  if (typeof first === 'number') {
    return typeof args[1] === 'string' ? args[1] : 'localhost'
  }
  if (typeof first === 'string') return undefined
  if (typeof first !== 'object' || first === null) return 'localhost'
  if (typeof first.path === 'string') return undefined
  return typeof first.host === 'string'
    ? first.host
    : typeof first.hostname === 'string'
      ? first.hostname
      : 'localhost'
}

net.Socket.prototype.connect = function testIsolatedConnect(...args) {
  const host = endpointHost(args)
  if (host !== undefined) assertLoopback(host)
  return originalConnect.apply(this, args)
}

dgram.Socket.prototype.send = function testIsolatedSend(...args) {
  const address = args.slice(1).findLast((argument) => typeof argument === 'string')
  assertLoopback(address ?? 'localhost')
  return originalSend.apply(this, args)
}

dgram.Socket.prototype.connect = function testIsolatedDatagramConnect(...args) {
  const address = typeof args[1] === 'string' ? args[1] : 'localhost'
  assertLoopback(address)
  return originalDatagramConnect.apply(this, args)
}

const originalLookup = dns.lookup
dns.lookup = function testIsolatedLookup(hostname, ...args) {
  assertLoopback(hostname)
  return originalLookup.call(this, hostname, ...args)
}

dns.lookupService = function testIsolatedLookupService() {
  throwNetworkDisabled()
}

const resolverMethods = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]

for (const name of resolverMethods) {
  dns[name] = function testIsolatedResolve() {
    throwNetworkDisabled()
  }
  dns.Resolver.prototype[name] = function testIsolatedResolverInstance() {
    throwNetworkDisabled()
  }
}

const originalPromiseLookup = dns.promises.lookup
dns.promises.lookup = function testIsolatedPromiseLookup(hostname, ...args) {
  assertLoopback(hostname)
  return originalPromiseLookup.call(this, hostname, ...args)
}
dns.promises.lookupService = function testIsolatedPromiseLookupService() {
  throwNetworkDisabled()
}

for (const name of resolverMethods) {
  dns.promises[name] = function testIsolatedPromiseResolve() {
    throwNetworkDisabled()
  }
  dns.promises.Resolver.prototype[name] = function testIsolatedPromiseResolverInstance() {
    throwNetworkDisabled()
  }
}

function assertLoopback(host) {
  if (typeof host === 'string' && loopback.test(host)) return
  throwNetworkDisabled()
}

function throwNetworkDisabled() {
  const error = new Error('External network access is disabled in automated tests.')
  error.code = 'SIMPROOF_TEST_NETWORK_DISABLED'
  throw error
}
