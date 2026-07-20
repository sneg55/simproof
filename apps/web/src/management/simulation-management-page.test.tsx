import type { EducatorVersionDetail } from '@simproof/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { LibraryManagementApi } from '@/api/library-management-api'
import type { DownloadPort } from '@/management/download-port'
import {
  generationRecoveryPath,
  SimulationManagementPageView,
} from '@/management/simulation-management-page'
import {
  accepted,
  comparison,
  managementApi,
  simulationDetail,
  simulationId,
  versionHistory,
  versionOne,
  versionOneId,
  versionTwoId,
} from '@/management/test-fixtures'

const csrfToken = 'c'.repeat(43)

function renderPage(
  api: LibraryManagementApi,
  options: {
    download?: DownloadPort
    onDeleted?: (id: string) => void
    onArchived?: (detail: ReturnType<typeof simulationDetail>) => void
    onDuplicated?: (id: string) => void
    onReverifyAccepted?: (id: string) => void
    passwordConfirmationRequired?: boolean
  } = {},
) {
  return render(
    <MemoryRouter>
      <SimulationManagementPageView
        api={api}
        csrfToken={csrfToken}
        download={options.download}
        onDeleted={options.onDeleted ?? vi.fn()}
        onArchived={options.onArchived ?? vi.fn()}
        onDuplicated={options.onDuplicated ?? vi.fn()}
        onReverifyAccepted={options.onReverifyAccepted}
        passwordConfirmationRequired={options.passwordConfirmationRequired}
        simulationId={simulationId}
      />
    </MemoryRouter>,
  )
}

describe('simulation management page', () => {
  it('keeps loading and unavailable management states titled, headed, and non-disruptive to focus', async () => {
    let resolveDetail:
      | ((result: Awaited<ReturnType<LibraryManagementApi['simulationDetail']>>) => void)
      | undefined
    const pendingDetail = new Promise<
      Awaited<ReturnType<LibraryManagementApi['simulationDetail']>>
    >((resolve) => {
      resolveDetail = resolve
    })
    renderPage(
      managementApi({
        simulationDetail: vi
          .fn<LibraryManagementApi['simulationDetail']>()
          .mockReturnValue(pendingDetail),
      }),
    )
    const focusTarget = document.createElement('button')
    focusTarget.textContent = 'Existing focus target'
    document.body.append(focusTarget)
    focusTarget.focus()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading simulation management' }),
    ).toBeVisible()
    expect(document.title).toBe('Loading simulation management | SimProof')
    expect(focusTarget).toHaveFocus()

    resolveDetail?.({ ok: false, error: { kind: 'unavailable', id: 'fixture.unavailable' } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simulation management unavailable' }),
    ).toBeVisible()
    expect(document.title).toBe('Simulation management unavailable | SimProof')
    expect(focusTarget).toHaveFocus()
    focusTarget.remove()
  })

  it('uses the generation recovery query contract for accepted reverification runs', () => {
    expect(generationRecoveryPath(simulationId, accepted().runId)).toBe(
      `/simulations/${simulationId}/generate?runId=${accepted().runId}`,
    )
  })

  it('loads detail/history together and renders every server comparison field with text cues', async () => {
    const simulationDetailRequest = vi
      .fn<LibraryManagementApi['simulationDetail']>()
      .mockResolvedValue({ ok: true, value: simulationDetail() })
    const historyRequest = vi
      .fn<LibraryManagementApi['versionHistory']>()
      .mockResolvedValue({ ok: true, value: versionHistory() })
    const compareVersions = vi
      .fn<LibraryManagementApi['compareVersions']>()
      .mockResolvedValue({ ok: true, value: comparison() })
    const api = managementApi({
      compareVersions,
      simulationDetail: simulationDetailRequest,
      versionHistory: historyRequest,
    })
    renderPage(api)

    expect(await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })).toBeVisible()
    expect(simulationDetailRequest).toHaveBeenCalledWith(simulationId, expect.any(AbortSignal))
    expect(historyRequest).toHaveBeenCalledWith(simulationId, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }))

    expect(await screen.findByText('Lifecycle state')).toBeVisible()
    expect(screen.getByText('Verification policy')).toBeVisible()
    expect(screen.getByText('Findings')).toBeVisible()
    expect(screen.getByText('Publication')).toBeVisible()
    expect(screen.getAllByText('Changed')).toHaveLength(4)
    expect(screen.getAllByText('Left policy')).not.toHaveLength(0)
    expect(screen.getAllByText('Right policy')).not.toHaveLength(0)
    expect(compareVersions).toHaveBeenCalledWith(simulationId, versionOneId, versionTwoId)
    for (const table of screen.getAllByRole('table')) {
      expect(table.querySelector('caption')).not.toBeNull()
    }
  })

  it('resets source and comparison defaults when authoritative history adds a version', async () => {
    const firstVersion: EducatorVersionDetail = {
      ...versionOne(),
      availableActions: ['start-blank-version', 'duplicate', 'export'],
    }
    const complete = simulationDetail()
    const first: typeof complete = {
      simulation: {
        ...complete.simulation,
        currentVersion: firstVersion.summary,
      },
      selectedVersion: firstVersion,
    }
    const simulationDetailRequest = vi
      .fn<LibraryManagementApi['simulationDetail']>()
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValue({ ok: true, value: complete })
    const historyRequest = vi
      .fn<LibraryManagementApi['versionHistory']>()
      .mockResolvedValueOnce({
        ok: true,
        value: { simulationId, versions: [firstVersion] },
      })
      .mockResolvedValue({ ok: true, value: versionHistory() })
    const startBlankVersion = vi
      .fn<LibraryManagementApi['startBlankVersion']>()
      .mockResolvedValue({ ok: true, value: complete })

    renderPage(
      managementApi({
        startBlankVersion,
        simulationDetail: simulationDetailRequest,
        versionHistory: historyRequest,
      }),
    )
    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    fireEvent.click(screen.getByRole('button', { name: 'Start blank next version' }))

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Source version' })).toHaveTextContent(
        'Version 2',
      ),
    )
    expect(screen.getByRole('button', { name: 'Compare versions' })).toBeEnabled()
  })

  it('uses exact source and stale revisions for create, duplicate, archive, and reverify', async () => {
    const duplicatedId = '66666666-6666-4666-8666-666666666666'
    const duplicateBase = simulationDetail()
    const duplicatedDetail = {
      ...duplicateBase,
      simulation: { ...duplicateBase.simulation, id: duplicatedId },
    }
    const startBlankVersion = vi
      .fn<LibraryManagementApi['startBlankVersion']>()
      .mockResolvedValue({ ok: true, value: simulationDetail() })
    const duplicateSimulation = vi
      .fn<LibraryManagementApi['duplicateSimulation']>()
      .mockResolvedValue({ ok: true, value: duplicatedDetail })
    const archiveVersion = vi
      .fn<LibraryManagementApi['archiveVersion']>()
      .mockResolvedValue({ ok: true, value: simulationDetail() })
    const reverifyVersion = vi
      .fn<LibraryManagementApi['reverifyVersion']>()
      .mockResolvedValue({ ok: true, value: accepted() })
    const onReverifyAccepted = vi.fn()
    const onDuplicated = vi.fn()
    const onArchived = vi.fn()
    renderPage(
      managementApi({ startBlankVersion, duplicateSimulation, archiveVersion, reverifyVersion }),
      { onArchived, onDuplicated, onReverifyAccepted },
    )

    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    fireEvent.click(screen.getByRole('button', { name: 'Start blank next version' }))
    await waitFor(() =>
      expect(startBlankVersion).toHaveBeenCalledWith(
        simulationId,
        { sourceVersionId: versionTwoId, expectedSourceRevision: 9 },
        csrfToken,
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate selected version' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New simulation title' }), {
      target: { value: 'Copied lesson' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create duplicate' }))
    await waitFor(() =>
      expect(duplicateSimulation).toHaveBeenCalledWith(
        simulationId,
        { sourceVersionId: versionTwoId, expectedSourceRevision: 9, title: 'Copied lesson' },
        csrfToken,
      ),
    )
    expect(onDuplicated).toHaveBeenCalledWith(duplicatedId)

    fireEvent.click(await screen.findByRole('button', { name: 'Archive this version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }))
    await waitFor(() =>
      expect(archiveVersion).toHaveBeenCalledWith(versionTwoId, { expectedRevision: 9 }, csrfToken),
    )
    expect(onArchived).toHaveBeenCalledWith(simulationDetail())

    fireEvent.click(await screen.findByRole('button', { name: 'Reverify stale version' }))
    await waitFor(() =>
      expect(reverifyVersion).toHaveBeenCalledWith(
        versionTwoId,
        { expectedRevision: 9, idempotencyKey: `reverify:${versionTwoId}:9` },
        csrfToken,
      ),
    )
    expect(onReverifyAccepted).toHaveBeenCalledWith(accepted().runId)
  })

  it('clears export passwords after failure and downloads only validated successful JSON', async () => {
    const exportSimulation = vi
      .fn<LibraryManagementApi['exportSimulation']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'permission', id: 'http.password-denied' },
      })
      .mockResolvedValueOnce({ ok: true, value: { schemaVersion: '1' } as never })
    const save = vi.fn<DownloadPort['save']>()
    renderPage(managementApi({ exportSimulation }), { download: { save } })

    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    fireEvent.click(screen.getByRole('button', { name: 'Export selected simulation' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'not-sent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export selected simulation' }))
    expect(screen.getByLabelText('Current password')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON export' }))
    const exportFailure = await screen.findByText(
      'The export was not created. Confirm the current password.',
    )
    const exportDialog = screen.getByRole('dialog')
    await waitFor(() => expect(exportFailure.closest('[role="alert"]')).toHaveFocus())
    expect(within(exportDialog).getByLabelText('Current password')).toHaveValue('')
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(within(exportDialog).getByLabelText('Current password'), {
      target: { value: 'correct' },
    })
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Download JSON export' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith({
      content: '{\n  "schemaVersion": "1"\n}',
      fileName: `simproof-${simulationId}.json`,
      mediaType: 'application/json',
    })
  })

  it('requires password plus exact delete confirmation, clears secrets, focuses failure, and navigates on success', async () => {
    const deleteSimulation = vi
      .fn<LibraryManagementApi['deleteSimulation']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'permission', id: 'http.password-denied' },
      })
      .mockResolvedValueOnce({ ok: true, value: { deletedArtifacts: [], deferredArtifacts: [] } })
    const onDeleted = vi.fn()
    renderPage(managementApi({ deleteSimulation }), { onDeleted })

    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete simulation' }))
    let dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'not-sent' },
    })
    fireEvent.change(within(dialog).getByLabelText('Type delete'), { target: { value: 'delete' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete simulation' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Current password')).toHaveValue('')
    expect(within(dialog).getByLabelText('Type delete')).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'wrong' },
    })
    const deleteButton = within(dialog).getByRole('button', {
      name: 'Permanently delete simulation',
    })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type delete'), { target: { value: 'delete' } })
    fireEvent.click(deleteButton)

    const failure = await screen.findByText(
      'The simulation was not deleted. Confirm the current password.',
    )
    await waitFor(() => expect(failure.closest('[role="alert"]')).toHaveFocus())
    expect(deleteSimulation).toHaveBeenCalledWith(simulationId, 'wrong', csrfToken)
    expect(onDeleted).not.toHaveBeenCalled()

    const retried = screen.getByRole('dialog')
    expect(within(retried).getByLabelText('Current password')).toHaveValue('')
    expect(within(retried).getByLabelText('Type delete')).toHaveValue('delete')
    fireEvent.change(within(retried).getByLabelText('Current password'), {
      target: { value: 'correct' },
    })
    fireEvent.change(within(retried).getByLabelText('Type delete'), { target: { value: 'delete' } })
    fireEvent.click(within(retried).getByRole('button', { name: 'Permanently delete simulation' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('Pendulum lesson'))
    expect(deleteSimulation).toHaveBeenLastCalledWith(simulationId, 'correct', csrfToken)
    await waitFor(() =>
      expect(
        screen.getByText('The simulation and its files were deleted.').closest('[role="alert"]'),
      ).toHaveFocus(),
    )
  })

  it('keeps blank-simulation failures open, focuses the summary, and preserves the title', async () => {
    const duplicateSimulation = vi
      .fn<LibraryManagementApi['duplicateSimulation']>()
      .mockResolvedValue({ ok: false, error: { kind: 'unavailable', id: 'http.unavailable' } })
    renderPage(managementApi({ duplicateSimulation }))

    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    const trigger = screen.getByRole('button', { name: 'Duplicate selected version' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    const title = within(dialog).getByLabelText('New simulation title')
    fireEvent.change(title, { target: { value: 'Separate lineage lesson' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create duplicate' }))

    const failure = await within(dialog).findByText('The simulation was not duplicated.')
    await waitFor(() => expect(failure.closest('[role="alert"]')).toHaveFocus())
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(title).toHaveValue('Separate lineage lesson')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('turns conflicts into a focused authoritative refresh prompt', async () => {
    const simulationDetailRequest = vi
      .fn<LibraryManagementApi['simulationDetail']>()
      .mockResolvedValue({ ok: true, value: simulationDetail() })
    const historyRequest = vi
      .fn<LibraryManagementApi['versionHistory']>()
      .mockResolvedValue({ ok: true, value: versionHistory() })
    const startBlankVersion = vi
      .fn<LibraryManagementApi['startBlankVersion']>()
      .mockResolvedValue({ ok: false, error: { kind: 'conflict', id: 'http.revision-conflict' } })
    const api = managementApi({
      startBlankVersion,
      simulationDetail: simulationDetailRequest,
      versionHistory: historyRequest,
    })
    renderPage(api)

    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    fireEvent.click(screen.getByRole('button', { name: 'Start blank next version' }))
    const prompt = await screen.findByText(
      'Refresh before trying again so the next command uses the current revision.',
    )
    await waitFor(() => expect(prompt.closest('[role="alert"]')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative version' }))
    await waitFor(() => expect(simulationDetailRequest).toHaveBeenCalledTimes(2))
    expect(historyRequest).toHaveBeenCalledTimes(2)
  })

  it('uses the chosen source version permissions for copy actions', async () => {
    renderPage(managementApi())
    await screen.findByRole('heading', { name: 'Manage Pendulum lesson' })
    expect(screen.getByRole('button', { name: 'Start blank next version' })).toBeVisible()

    fireEvent.click(screen.getByRole('combobox', { name: 'Source version' }))
    fireEvent.click(await screen.findByRole('option', { name: /Version 1 · revision 3/i }))

    expect(
      screen.queryByRole('button', { name: 'Start blank next version' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplicate selected version' })).toBeVisible()
  })

  it('explains archived versions remain portable and deletable without fabricating unarchive', async () => {
    renderPage(managementApi())
    expect(
      await screen.findByText(/Archiving cannot be undone here, and deleting is permanent/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /unarchive/i })).not.toBeInTheDocument()
  })
})
