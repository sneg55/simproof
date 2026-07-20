import { Link } from 'react-router-dom'

import { DocumentTitle } from '@/app/document-title'
import { Button } from '@/components/ui/button'

export function RouteErrorPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <DocumentTitle value="Page unavailable | SimProof" />
      <a
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-surface focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-ring/50"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="border-border border-b">
        <div className="mx-auto flex min-h-16 max-w-shell flex-wrap items-center justify-between gap-3 px-page">
          <span className="font-heading font-semibold tracking-tight">SimProof</span>
          <nav aria-label="Recovery">
            <Button asChild variant="ghost">
              <Link to="/">Simulation library</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto grid max-w-shell gap-4 px-page py-section" id="main-content">
        <h1 className="text-page-title font-heading font-semibold tracking-tight">
          This page could not be opened
        </h1>
        <p className="max-w-prose text-muted-foreground" role="alert">
          SimProof kept your saved work unchanged. Return to the library and try the action again.
        </p>
        <div>
          <Button asChild>
            <Link to="/">Return to simulation library</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
