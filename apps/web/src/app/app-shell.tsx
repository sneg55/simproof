import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { DocumentTitle } from '@/app/document-title'
import { ThemeToggle } from '@/app/theme-toggle'
import { useEducatorSession } from '@/auth/session-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const navigationLinkClass =
  'inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-foreground'

export function AppShell() {
  const { pathname } = useLocation()
  const { api, expireSession, session } = useEducatorSession()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    setSignOutFailed(false)
    const result = await api.logout(session.csrfToken)
    if (result.ok) {
      expireSession()
      return
    }
    setSigningOut(false)
    setSignOutFailed(true)
  }

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('#main-content')
    if (main === null) return
    let shellFocusedHeading: HTMLElement | null = null
    let followReplacement = true
    const focusHeading = () => {
      const heading = main.querySelector<HTMLElement>('h1')
      if (heading === null) return false
      heading.tabIndex = -1
      shellFocusedHeading = heading
      heading.focus()
      return true
    }
    const respectFocusMove = (event: FocusEvent) => {
      if (
        shellFocusedHeading?.isConnected === true &&
        event.target !== shellFocusedHeading &&
        event.target instanceof HTMLElement &&
        event.target.isConnected
      ) {
        followReplacement = false
      }
    }
    document.addEventListener('focusin', respectFocusMove)
    focusHeading()
    const observer = new MutationObserver(() => {
      if (!followReplacement || shellFocusedHeading?.isConnected === true || !focusHeading()) {
        return
      }
    })
    observer.observe(main, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('focusin', respectFocusMove)
      observer.disconnect()
    }
  }, [pathname])

  return (
    <>
      <DocumentTitle value="SimProof" />
      <div className="min-h-svh bg-background text-foreground">
        <a
          className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-surface focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-ring/50"
          href="#main-content"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-40 border-border border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex min-h-16 max-w-shell flex-wrap items-center justify-between gap-3 px-page">
            <span className="font-heading text-base font-semibold tracking-tight">SimProof</span>
            <div className="flex flex-wrap items-center gap-1">
              <nav aria-label="Primary">
                <NavLink className={navigationLinkClass} end to="/">
                  Simulation library
                </NavLink>
              </nav>
              <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <ThemeToggle />
              {session.authenticationMode === 'local-bypass' ? (
                <Badge variant="secondary">Local test access</Badge>
              ) : (
                <Button
                  disabled={signingOut}
                  onClick={() => void signOut()}
                  size="sm"
                  variant="ghost"
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              )}
            </div>
            {signOutFailed ? (
              <p className="basis-full text-right text-sm text-destructive" role="alert">
                Sign out failed. Check the local service and try again.
              </p>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-shell px-page py-section" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </>
  )
}
