import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the image import so Vitest doesn't try to resolve .png files
vi.mock('./assets/lyre_crate_logo.svg', () => ({ default: 'mock-logo.svg' }))

// Mock the useFollowerAnalysis hook to control state
vi.mock('./hooks/useFollowerAnalysis', () => ({
  useFollowerAnalysis: vi.fn(),
}))

import App from './App'
import { useFollowerAnalysis } from './hooks/useFollowerAnalysis'

const mockUseFollowerAnalysis = vi.mocked(useFollowerAnalysis)

describe('App', () => {
  const idleState = {
    progress: { phase: 'idle' as const, current: 0, total: 0, message: '' },
    result: null,
    error: null,
    mode: 'all' as const,
    analyze: vi.fn(),
    reset: vi.fn(),
    abort: vi.fn(),
  }

  it('renders header with title', () => {
    mockUseFollowerAnalysis.mockReturnValue(idleState)
    render(<App />)
    expect(screen.getByText('Harpo Crates')).toBeInTheDocument()
    expect(screen.getByText("Analyze Any Bluesky Account")).toBeInTheDocument()
  })

  it('renders logo image', () => {
    mockUseFollowerAnalysis.mockReturnValue(idleState)
    render(<App />)
    const logo = screen.getByAltText('Harpo Crates logo')
    expect(logo).toBeInTheDocument()
    expect(logo.getAttribute('src')).toBe('mock-logo.svg')
  })

  it('renders search bar', () => {
    mockUseFollowerAnalysis.mockReturnValue(idleState)
    render(<App />)
    expect(screen.getByPlaceholderText(/enter full handle/i)).toBeInTheDocument()
  })

  it('renders empty state when idle', () => {
    mockUseFollowerAnalysis.mockReturnValue(idleState)
    render(<App />)
    expect(screen.getByText('Enter a Bluesky handle above to get started')).toBeInTheDocument()
    expect(screen.getByText(/no login required/i)).toBeInTheDocument()
  })

  it('renders footer', () => {
    mockUseFollowerAnalysis.mockReturnValue(idleState)
    render(<App />)
    expect(screen.getByText(/harpo crates uses the public at protocol api/i)).toBeInTheDocument()
  })

  it('renders error state', () => {
    mockUseFollowerAnalysis.mockReturnValue({
      ...idleState,
      progress: { phase: 'error' as const, current: 0, total: 0, message: 'API error' },
      error: 'Could not find this user',
    })
    render(<App />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Could not find this user')).toBeInTheDocument()
  })

  it('does not show empty state when loading', () => {
    mockUseFollowerAnalysis.mockReturnValue({
      ...idleState,
      progress: { phase: 'followers' as const, current: 50, total: 100, message: 'Fetching...' },
    })
    render(<App />)
    expect(screen.queryByText('Enter a Bluesky handle above to get started')).not.toBeInTheDocument()
  })

  it('does not show empty state when error is present', () => {
    mockUseFollowerAnalysis.mockReturnValue({
      ...idleState,
      progress: { phase: 'error' as const, current: 0, total: 0, message: 'Error' },
      error: 'Some error',
    })
    render(<App />)
    expect(screen.queryByText('Enter a Bluesky handle above to get started')).not.toBeInTheDocument()
  })
})
