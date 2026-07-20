import { Moon, Sun } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

type Theme = 'dark' | 'light'
const STORAGE_KEY = 'simproof-theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // The selected theme still applies when browser storage is unavailable.
    }
    let settledFrame: number | undefined
    const appliedFrame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => root.classList.remove('theme-switching'))
    })
    return () => {
      window.cancelAnimationFrame(appliedFrame)
      if (settledFrame !== undefined) window.cancelAnimationFrame(settledFrame)
      root.classList.remove('theme-switching')
    }
  }, [theme])

  const dark = theme === 'dark'
  return (
    <Button
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
      aria-pressed={dark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      size="icon-sm"
      variant="ghost"
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  )
}

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Fall through to the system preference.
  }
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
