import { describe, expect, it } from 'vitest'
import { matchRequestTarget, validateRouteInventory } from './route-url.js'
import type { RouteDefinition } from './routes.js'

const simulationId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const routes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/simulations/:simulationId',
    key: 'session',
    access: 'authenticated',
    unsafe: false,
    parameters: { simulationId: 'uuid' },
  },
  {
    method: 'GET',
    path: '/api/simulations',
    key: 'session',
    access: 'authenticated',
    unsafe: false,
    queryKeys: ['cursor', 'domain', 'limit', 'search', 'state'],
  },
  {
    method: 'POST',
    path: '/api/seeds/:exampleId/install',
    key: 'session',
    access: 'authenticated',
    unsafe: true,
    parameters: { exampleId: 'identifier' },
  },
]
const simulationDetailRoute = routes[0]
if (simulationDetailRoute === undefined)
  throw new Error('simulation detail route fixture is missing')

describe('canonical HTTP request-target matching', () => {
  it('matches strict resource parameters and route-owned query keys', () => {
    expect(matchRequestTarget('GET', `/api/simulations/${simulationId}`, routes)).toEqual({
      ok: true,
      match: {
        route: routes[0],
        parameters: { simulationId },
        query: {},
      },
    })
    expect(
      matchRequestTarget(
        'GET',
        '/api/simulations?domain=projectile&limit=25&search=launch%20lab',
        routes,
      ),
    ).toEqual({
      ok: true,
      match: {
        route: routes[1],
        parameters: {},
        query: { domain: 'projectile', limit: '25', search: 'launch lab' },
      },
    })
    expect(matchRequestTarget('POST', '/api/seeds/projectile.basics/install', routes)).toEqual({
      ok: true,
      match: {
        route: routes[2],
        parameters: { exampleId: 'projectile.basics' },
        query: {},
      },
    })
  })

  it.each([
    'https://example.test/api/simulations',
    '//example.test/api/simulations',
    '/api/simulations#fragment',
    '/api/simulations/',
    '/api//simulations',
    '/api/%2e%2e/simulations',
    '/api/simulations?search=bad+space',
    '/api/simulations?search=%',
    '/api/simulations?search=one&search=two',
    '/api/simulations?unknown=true',
    '/api/simulations?__proto__=polluted',
    '/api/simulations?search=%00',
    '/api/%09simulations',
  ])('rejects malformed or noncanonical target %s', (target) => {
    expect(matchRequestTarget('GET', target, routes)).toEqual({
      ok: false,
      errorId: 'http.invalid-request-target',
    })
  })

  it('rejects encoded separators, noncanonical UUIDs, and unknown resource tails', () => {
    for (const target of [
      `/api/simulations/${simulationId}%2Freport`,
      `/api/simulations/${simulationId}%5Creport`,
      `/api/simulations/${simulationId.toUpperCase()}`,
      '/api/simulations/not-a-uuid',
    ]) {
      expect(matchRequestTarget('GET', target, routes)).toEqual({
        ok: false,
        errorId: 'http.invalid-request-target',
      })
    }
    expect(matchRequestTarget('GET', `/api/simulations/${simulationId}/report`, routes)).toEqual({
      ok: true,
      match: undefined,
    })
  })

  it('fails closed on ambiguous templates and invalid inventory declarations', () => {
    expect(() =>
      validateRouteInventory([
        ...routes,
        { ...simulationDetailRoute, path: '/api/simulations/:id', parameters: { id: 'uuid' } },
      ]),
    ).toThrow(/ambiguous/u)
    expect(() =>
      validateRouteInventory([
        {
          ...simulationDetailRoute,
          path: '/api/simulations/:missing',
          parameters: { id: 'uuid' },
        },
      ]),
    ).toThrow(/parameter/u)
  })

  it('bounds path and query input before decoding', () => {
    expect(matchRequestTarget('GET', `/api/${'a'.repeat(2_100)}`, routes).ok).toBe(false)
    expect(
      matchRequestTarget('GET', `/api/simulations?search=${'a'.repeat(2_100)}`, routes).ok,
    ).toBe(false)
  })
})
