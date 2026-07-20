type Access = 'public' | 'authenticated'
export type RouteParameterKind = 'identifier' | 'uuid'

export type RouteKey =
  | 'health'
  | 'readiness'
  | 'bootstrap'
  | 'login'
  | 'logout'
  | 'rotate'
  | 'password'
  | 'session'
  | 'privacy-get'
  | 'privacy-update'
  | 'privacy-export'
  | 'privacy-delete'
  | 'generation-start'
  | 'generation-cancel'
  | 'bootstrap-capability'
  | 'runtime-config'
  | 'seeds-list'
  | 'seed-detail'
  | 'seed-report'
  | 'seed-preview'
  | 'simulations-list'
  | 'simulation-detail'
  | 'simulation-create'
  | 'simulation-history'
  | 'simulation-compare'
  | 'simulation-version-create'
  | 'simulation-duplicate'
  | 'educator-generation-start'
  | 'educator-generation-status'
  | 'educator-generation-concept'
  | 'educator-generation-cancel'
  | 'version-report'
  | 'version-publish'
  | 'version-archive'
  | 'version-reverify'
  | 'simulation-export'
  | 'version-preview'

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly path: string
  readonly key: RouteKey
  readonly access: Access
  readonly unsafe: boolean
  readonly parameters?: Readonly<Record<string, RouteParameterKind>>
  readonly queryKeys?: readonly string[]
}

export const ROUTE_INVENTORY: readonly RouteDefinition[] = Object.freeze([
  { method: 'GET', path: '/health', key: 'health', access: 'public', unsafe: false },
  { method: 'GET', path: '/ready', key: 'readiness', access: 'public', unsafe: false },
  {
    method: 'GET',
    path: '/api/bootstrap-capability',
    key: 'bootstrap-capability',
    access: 'public',
    unsafe: false,
  },
  { method: 'POST', path: '/api/auth/bootstrap', key: 'bootstrap', access: 'public', unsafe: true },
  { method: 'POST', path: '/api/auth/login', key: 'login', access: 'public', unsafe: true },
  authMutation('/api/auth/logout', 'logout'),
  authMutation('/api/auth/rotate', 'rotate'),
  authMutation('/api/auth/password', 'password'),
  { method: 'GET', path: '/api/session', key: 'session', access: 'authenticated', unsafe: false },
  {
    method: 'GET',
    path: '/api/privacy/settings',
    key: 'privacy-get',
    access: 'authenticated',
    unsafe: false,
  },
  {
    method: 'PUT',
    path: '/api/privacy/settings',
    key: 'privacy-update',
    access: 'authenticated',
    unsafe: true,
  },
  authMutation('/api/privacy/export', 'privacy-export'),
  {
    method: 'DELETE',
    path: '/api/privacy/simulation',
    key: 'privacy-delete',
    access: 'authenticated',
    unsafe: true,
  },
  authMutation('/api/generation', 'generation-start'),
  authMutation('/api/generation/cancel', 'generation-cancel'),
  educatorRead('/api/runtime-config', 'runtime-config'),
  educatorRead('/api/seeds', 'seeds-list'),
  educatorIdentifierRead('/api/seeds/:seedId', 'seed-detail', 'seedId'),
  educatorIdentifierRead('/api/seeds/:seedId/report', 'seed-report', 'seedId'),
  educatorIdentifierMutation('/api/seeds/:seedId/preview', 'seed-preview', 'seedId'),
  {
    ...educatorRead('/api/simulations', 'simulations-list'),
    queryKeys: ['cursor', 'domain', 'limit', 'search', 'source', 'state'],
  },
  educatorMutation('/api/simulations', 'simulation-create'),
  educatorResourceRead('/api/simulations/:simulationId', 'simulation-detail', 'simulationId'),
  educatorResourceRead(
    '/api/simulations/:simulationId/versions',
    'simulation-history',
    'simulationId',
  ),
  educatorResourceMutation(
    '/api/simulations/:simulationId/versions',
    'simulation-version-create',
    'simulationId',
  ),
  {
    ...educatorResourceRead(
      '/api/simulations/:simulationId/compare',
      'simulation-compare',
      'simulationId',
    ),
    queryKeys: ['left', 'right'],
  },
  educatorResourceMutation(
    '/api/simulations/:simulationId/duplicate',
    'simulation-duplicate',
    'simulationId',
  ),
  educatorResourceMutation(
    '/api/simulations/:simulationId/export',
    'simulation-export',
    'simulationId',
  ),
  educatorMutation('/api/generations', 'educator-generation-start'),
  educatorResourceRead('/api/generations/:runId', 'educator-generation-status', 'runId'),
  educatorResourceMutation(
    '/api/generations/:runId/concept-review',
    'educator-generation-concept',
    'runId',
  ),
  educatorResourceMutation(
    '/api/generations/:runId/cancellation',
    'educator-generation-cancel',
    'runId',
  ),
  educatorResourceRead('/api/versions/:versionId/report', 'version-report', 'versionId'),
  educatorResourceMutation('/api/versions/:versionId/publish', 'version-publish', 'versionId'),
  educatorResourceMutation('/api/versions/:versionId/archive', 'version-archive', 'versionId'),
  educatorResourceMutation('/api/versions/:versionId/reverify', 'version-reverify', 'versionId'),
  educatorResourceMutation('/api/versions/:versionId/preview', 'version-preview', 'versionId'),
])

export function findRoute(method: string, path: string): RouteDefinition | undefined {
  return ROUTE_INVENTORY.find((route) => route.method === method && route.path === path)
}

function authMutation(path: string, key: RouteKey): RouteDefinition {
  return { method: 'POST', path, key, access: 'authenticated', unsafe: true }
}

function educatorRead(path: string, key: RouteKey): RouteDefinition {
  return { method: 'GET', path, key, access: 'authenticated', unsafe: false }
}

function educatorMutation(path: string, key: RouteKey): RouteDefinition {
  return { method: 'POST', path, key, access: 'authenticated', unsafe: true }
}

function educatorResourceRead(path: string, key: RouteKey, parameter: string): RouteDefinition {
  return { ...educatorRead(path, key), parameters: { [parameter]: 'uuid' } }
}

function educatorResourceMutation(path: string, key: RouteKey, parameter: string): RouteDefinition {
  return { ...educatorMutation(path, key), parameters: { [parameter]: 'uuid' } }
}

function educatorIdentifierRead(path: string, key: RouteKey, parameter: string): RouteDefinition {
  return { ...educatorRead(path, key), parameters: { [parameter]: 'identifier' } }
}

function educatorIdentifierMutation(
  path: string,
  key: RouteKey,
  parameter: string,
): RouteDefinition {
  return { ...educatorMutation(path, key), parameters: { [parameter]: 'identifier' } }
}
