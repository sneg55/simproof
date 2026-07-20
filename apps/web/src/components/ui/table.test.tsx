import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Table, TableBody, TableCaption, TableCell, TableRow } from '@/components/ui/table'

describe('table', () => {
  it('names the focusable horizontal scroll region and preserves the table caption', () => {
    render(
      <Table scrollLabel="Scrollable verification evidence">
        <TableCaption>Verification evidence for the selected version.</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>Current</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const region = screen.getByRole('region', { name: 'Scrollable verification evidence' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table')).toHaveAccessibleName(
      'Verification evidence for the selected version.',
    )
  })
})
