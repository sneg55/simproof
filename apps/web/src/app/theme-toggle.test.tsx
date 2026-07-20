import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeToggle } from '@/app/theme-toggle'

describe('theme toggle', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.remove('theme-switching')
    document.documentElement.style.colorScheme = ''
    window.localStorage.removeItem('simproof-theme')
  })

  it('applies and persists a reachable dark theme preference', () => {
    render(<ThemeToggle />)

    const toggle = screen.getByRole('button', { name: 'Use dark theme' })
    fireEvent.click(toggle)

    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(window.localStorage.getItem('simproof-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Use light theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('returns the root and persisted preference to light mode', () => {
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use light theme' }))

    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(window.localStorage.getItem('simproof-theme')).toBe('light')
  })
})
