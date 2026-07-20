import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

import type { LibraryManagementApi } from '@/api/library-management-api'
import type { DownloadPort } from '@/management/download-port'
import { SimulationManagementPageView } from '@/management/simulation-management-page'
import { managementApi, simulationId } from '@/management/test-fixtures'

const csrfToken = 'c'.repeat(43)

it('removes password fields from export and deletion under local test access', async () => {
  const exportSimulation = vi
    .fn<LibraryManagementApi['exportSimulation']>()
    .mockResolvedValue({ ok: true, value: { schemaVersion: '1' } as never })
  const save = vi.fn<DownloadPort['save']>()

  render(
    <MemoryRouter>
      <SimulationManagementPageView
        api={managementApi({ exportSimulation })}
        csrfToken={csrfToken}
        download={{ save }}
        onArchived={vi.fn()}
        onDeleted={vi.fn()}
        onDuplicated={vi.fn()}
        passwordConfirmationRequired={false}
        simulationId={simulationId}
      />
    </MemoryRouter>,
  )

  await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
  fireEvent.click(screen.getByRole('button', { name: 'Export selected simulation' }))
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Download JSON export' }))
  await waitFor(() =>
    expect(exportSimulation).toHaveBeenCalledWith(simulationId, 'local-test-access', csrfToken),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Delete simulation' }))
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Type delete')).toBeVisible()
})
