export interface PublicationSuccessNotice {
  readonly kind: 'publication-success'
  readonly versionNumber: number
}

interface SimulationRouteState {
  readonly notice: PublicationSuccessNotice
}

export function publicationSuccessRouteState(versionNumber: number): SimulationRouteState {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new TypeError('Published version number is invalid.')
  }
  return { notice: { kind: 'publication-success', versionNumber } }
}

export function publicationNoticeFromRouteState(
  value: unknown,
): PublicationSuccessNotice | undefined {
  if (!plainRecordWithKeys(value, ['notice'])) return undefined
  const notice = value.notice
  if (!plainRecordWithKeys(notice, ['kind', 'versionNumber'])) return undefined
  return notice.kind === 'publication-success' &&
    Number.isInteger(notice.versionNumber) &&
    Number(notice.versionNumber) >= 1
    ? { kind: 'publication-success', versionNumber: Number(notice.versionNumber) }
    : undefined
}

function plainRecordWithKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}
