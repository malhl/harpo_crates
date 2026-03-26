import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from './SearchBar'

describe('SearchBar', () => {
  const defaultProps = {
    onSearch: vi.fn(),
    loading: false,
    onReset: vi.fn(),
    hasResult: false,
  }

  it('renders input and button', () => {
    render(<SearchBar {...defaultProps} />)
    expect(screen.getByPlaceholderText(/enter full handle/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument()
  })

  it('calls onSearch with trimmed handle on submit', async () => {
    const onSearch = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onSearch={onSearch} />)

    await user.type(screen.getByPlaceholderText(/enter full handle/i), 'test.bsky.social')
    await user.click(screen.getByRole('button', { name: /analyze/i }))

    expect(onSearch).toHaveBeenCalledWith('test.bsky.social', 'all')
  })

  it('strips leading @ from handle', async () => {
    const onSearch = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onSearch={onSearch} />)

    await user.type(screen.getByPlaceholderText(/enter full handle/i), '@test.bsky.social')
    await user.click(screen.getByRole('button', { name: /analyze/i }))

    expect(onSearch).toHaveBeenCalledWith('test.bsky.social', 'all')
  })

  it('disables input and button when loading', () => {
    render(<SearchBar {...defaultProps} loading={true} />)
    expect(screen.getByPlaceholderText(/enter full handle/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /analyzing/i })).toBeDisabled()
  })

  it('shows "Analyzing..." text when loading', () => {
    render(<SearchBar {...defaultProps} loading={true} />)
    expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument()
  })

  it('disables submit button when input is empty', () => {
    render(<SearchBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: /analyze/i })).toBeDisabled()
  })

  it('does not show Clear button when no results', () => {
    render(<SearchBar {...defaultProps} hasResult={false} />)
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('shows Clear button when results are present', () => {
    render(<SearchBar {...defaultProps} hasResult={true} />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('calls onReset when Clear button is clicked', async () => {
    const onReset = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} hasResult={true} onReset={onReset} />)

    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('does not call onSearch with empty input', async () => {
    const onSearch = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onSearch={onSearch} />)

    // Type only spaces
    await user.type(screen.getByPlaceholderText(/enter full handle/i), '   ')
    await user.click(screen.getByRole('button', { name: /analyze/i }))

    expect(onSearch).not.toHaveBeenCalled()
  })
})
