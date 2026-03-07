import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingProgress } from './LoadingProgress'
import type { AnalysisProgress } from '../types'

describe('LoadingProgress', () => {
  it('renders nothing when phase is idle', () => {
    const progress: AnalysisProgress = { phase: 'idle', current: 0, total: 0, message: '' }
    const { container } = render(<LoadingProgress progress={progress} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when phase is done', () => {
    const progress: AnalysisProgress = { phase: 'done', current: 1, total: 1, message: 'Done!' }
    const { container } = render(<LoadingProgress progress={progress} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders progress bar during followers phase', () => {
    const progress: AnalysisProgress = {
      phase: 'followers',
      current: 50,
      total: 100,
      message: 'Fetching followers (50/100)...',
    }
    render(<LoadingProgress progress={progress} />)
    expect(screen.getByText('Fetching followers (50/100)...')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders progress bar during enriching phase', () => {
    const progress: AnalysisProgress = {
      phase: 'enriching',
      current: 25,
      total: 200,
      message: 'Enriching profiles (25/200)...',
    }
    render(<LoadingProgress progress={progress} />)
    expect(screen.getByText('Enriching profiles (25/200)...')).toBeInTheDocument()
    expect(screen.getByText('13%')).toBeInTheDocument()
  })

  it('renders during error phase', () => {
    const progress: AnalysisProgress = {
      phase: 'error',
      current: 0,
      total: 0,
      message: 'Something went wrong',
    }
    render(<LoadingProgress progress={progress} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('does not show percentage when total is 0', () => {
    const progress: AnalysisProgress = {
      phase: 'profile',
      current: 0,
      total: 0,
      message: 'Loading profile...',
    }
    render(<LoadingProgress progress={progress} />)
    expect(screen.getByText('Loading profile...')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('renders 100% when current equals total', () => {
    const progress: AnalysisProgress = {
      phase: 'followers',
      current: 500,
      total: 500,
      message: 'Fetching followers (500/500)...',
    }
    render(<LoadingProgress progress={progress} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
