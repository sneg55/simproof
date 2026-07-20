import type { NormalizedPreview } from '@simproof/contracts'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPreviewNumber } from '@/preview/format-preview-number'

const PAGE_SIZE = 50

export function PreviewDataTable({
  preview,
  currentIndex,
}: {
  readonly preview: NormalizedPreview
  readonly currentIndex: number
}) {
  const [page, setPage] = useState(() => Math.floor(currentIndex / PAGE_SIZE))
  const pageCount = Math.ceil(preview.samples.length / PAGE_SIZE)
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const end = Math.min(start + PAGE_SIZE, preview.samples.length)
  const samples = preview.samples.slice(start, end)

  const table =
    preview.domain === 'projectile' ? (
      <Table
        aria-label="Projectile trajectory data"
        scrollLabel="Scrollable projectile trajectory data"
      >
        <TableCaption>
          Rows {start + 1} to {end} of {preview.samples.length}.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Sample</TableHead>
            <TableHead scope="col">Time (s)</TableHead>
            <TableHead scope="col">Horizontal position (m)</TableHead>
            <TableHead scope="col">Height (m)</TableHead>
            <TableHead scope="col">Speed (m/s)</TableHead>
            <TableHead scope="col">Horizontal velocity (m/s)</TableHead>
            <TableHead scope="col">Vertical velocity (m/s)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.map((sample) => {
            if (!('xM' in sample)) return null
            return (
              <TableRow
                key={sample.index}
                aria-current={sample.index === currentIndex ? 'true' : undefined}
              >
                <TableCell data-dynamic-number>{sample.index + 1}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.timeS)}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.xM)}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.yM)}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.speedMps)}</TableCell>
                <TableCell data-dynamic-number>
                  {sample.velocityXMps === undefined
                    ? 'Not provided'
                    : formatPreviewNumber(sample.velocityXMps)}
                </TableCell>
                <TableCell data-dynamic-number>
                  {sample.velocityYMps === undefined
                    ? 'Not provided'
                    : formatPreviewNumber(sample.velocityYMps)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    ) : (
      <Table aria-label="Pendulum motion data" scrollLabel="Scrollable pendulum motion data">
        <TableCaption>
          Rows {start + 1} to {end} of {preview.samples.length}.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Sample</TableHead>
            <TableHead scope="col">Time (s)</TableHead>
            <TableHead scope="col">Angle (deg)</TableHead>
            <TableHead scope="col">Angular velocity (deg/s)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.map((sample) => {
            if (!('angleDeg' in sample)) return null
            return (
              <TableRow
                key={sample.index}
                aria-current={sample.index === currentIndex ? 'true' : undefined}
              >
                <TableCell data-dynamic-number>{sample.index + 1}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.timeS)}</TableCell>
                <TableCell data-dynamic-number>{formatPreviewNumber(sample.angleDeg)}</TableCell>
                <TableCell data-dynamic-number>
                  {sample.angularVelocityDegPerS === undefined
                    ? 'Not provided'
                    : formatPreviewNumber(sample.angularVelocityDegPerS)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  return (
    <div className="grid gap-3">
      {table}
      {pageCount > 1 ? (
        <nav aria-label="Data table pages" className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            aria-label="Previous data page"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground" data-dynamic-number>
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={safePage === pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            aria-label="Next data page"
          >
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
