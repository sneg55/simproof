import type { NormalizedPreview } from '@simproof/contracts'
import { useId } from 'react'

import { PendulumGraphic } from '@/preview/pendulum-graphic'
import { ProjectileGraphic } from '@/preview/projectile-graphic'

export function PreviewGraphic({
  preview,
  sampleIndex,
}: {
  readonly preview: NormalizedPreview
  readonly sampleIndex: number
}) {
  // useId() contains colons, which are invalid inside SVG url(#id) references
  // used by the scene filters, gradients, and arrowhead markers. Strip them so
  // the def ids and their references match and stay valid selectors.
  const id = useId().replace(/:/g, '')
  return preview.domain === 'projectile' ? (
    <ProjectileGraphic id={id} preview={preview} sampleIndex={sampleIndex} />
  ) : (
    <PendulumGraphic id={id} preview={preview} sampleIndex={sampleIndex} />
  )
}
