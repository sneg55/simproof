import type { RouteObject } from 'react-router-dom'

import { AppShell } from '@/app/app-shell'
import { RouteErrorPage } from '@/app/route-error'
import { SessionBoundary } from '@/auth/session-boundary'
import { LibraryPage } from '@/library/library-page'
import { SimulationDetailPage } from '@/library/simulation-detail-page'

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: (
      <SessionBoundary>
        <AppShell />
      </SessionBoundary>
    ),
    hydrateFallbackElement: (
      <main className="mx-auto grid min-h-svh max-w-prose place-content-center px-page py-section">
        <p className="font-heading text-xl font-semibold" role="status">
          Loading SimProof…
        </p>
      </main>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'simulations/:simulationId', element: <SimulationDetailPage /> },
      {
        path: 'simulations/new',
        lazy: async () => {
          const module = await import('@/generation/new-simulation-page')
          return { Component: module.NewSimulationPage }
        },
      },
      {
        path: 'simulations/:simulationId/manage',
        lazy: async () => {
          const module = await import('@/management/simulation-management-page')
          return { Component: module.SimulationManagementPage }
        },
      },
      {
        path: 'simulations/:simulationId/generate',
        lazy: async () => {
          const module = await import('@/generation/generation-page')
          return { Component: module.GenerationPage }
        },
      },
      {
        path: 'seeds/:seedId/report',
        lazy: async () => {
          const module = await import('@/report/report-route')
          return { Component: module.SeedReportPage }
        },
      },
      {
        path: 'seeds/:seedId/preview',
        lazy: async () => {
          const module = await import('@/preview/preview-route')
          return { Component: module.SeedPreviewPage }
        },
      },
      {
        path: 'simulations/:simulationId/preview',
        lazy: async () => {
          const module = await import('@/preview/preview-route')
          return { Component: module.VersionPreviewPage }
        },
      },
      {
        path: 'versions/:versionId/report',
        lazy: async () => {
          const module = await import('@/report/report-route')
          return { Component: module.VersionReportPage }
        },
      },
    ],
  },
]
