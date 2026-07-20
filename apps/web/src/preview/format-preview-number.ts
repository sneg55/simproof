const DISPLAY_PRECISION = 3
const ZERO_THRESHOLD = 0.5 * 10 ** -DISPLAY_PRECISION

const previewNumberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: DISPLAY_PRECISION,
  minimumFractionDigits: 0,
  useGrouping: false,
})

export function formatPreviewNumber(value: number): string {
  return previewNumberFormat.format(Math.abs(value) < ZERO_THRESHOLD ? 0 : value)
}
