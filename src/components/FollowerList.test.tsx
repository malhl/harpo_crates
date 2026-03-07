import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FollowerList } from './FollowerList'
import { makeFollower } from '../test/fixtures'

const followers = [
  makeFollower({ did: 'did:1', handle: 'alice.bsky.social', displayName: 'Alice', followersCount: 100, postsCount: 50, followsCount: 30, description: 'Loves coding' }),
  makeFollower({ did: 'did:2', handle: 'bob.bsky.social', displayName: 'Bob', followersCount: 5000, postsCount: 200, followsCount: 100, description: 'Artist' }),
  makeFollower({ did: 'did:3', handle: 'charlie.bsky.social', displayName: 'Charlie', followersCount: 10, postsCount: 5, followsCount: 2 }),
]

describe('FollowerList', () => {
  it('renders all followers', () => {
    render(<FollowerList followers={followers} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('shows result count', () => {
    render(<FollowerList followers={followers} />)
    expect(screen.getByText('3 results')).toBeInTheDocument()
  })

  it('filters by text search', async () => {
    const user = userEvent.setup()
    render(<FollowerList followers={followers} />)
    await user.type(screen.getByPlaceholderText('Filter followers...'), 'alice')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.getByText('1 results')).toBeInTheDocument()
  })

  it('searches in description text', async () => {
    const user = userEvent.setup()
    render(<FollowerList followers={followers} />)
    await user.type(screen.getByPlaceholderText('Filter followers...'), 'coding')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('shows empty state when no followers match filter', async () => {
    const user = userEvent.setup()
    render(<FollowerList followers={followers} />)
    await user.type(screen.getByPlaceholderText('Filter followers...'), 'nonexistent')
    expect(screen.getByText('No followers match this filter.')).toBeInTheDocument()
  })

  it('renders sort buttons', () => {
    render(<FollowerList followers={followers} />)
    expect(screen.getByText(/Followers/)).toBeInTheDocument()
    expect(screen.getByText(/Posts/)).toBeInTheDocument()
    expect(screen.getByText(/Following/)).toBeInTheDocument()
    expect(screen.getByText(/Name/)).toBeInTheDocument()
  })

  it('toggles sort direction when clicking same sort button', async () => {
    const user = userEvent.setup()
    render(<FollowerList followers={followers} />)
    const followersBtn = screen.getByRole('button', { name: /Followers/ })
    // Default is descending
    expect(followersBtn.textContent).toContain('↓')
    await user.click(followersBtn)
    const updatedBtn = screen.getByRole('button', { name: /Followers/ })
    expect(updatedBtn.textContent).toContain('↑')
  })

  it('changes sort key when clicking different sort button', async () => {
    const user = userEvent.setup()
    render(<FollowerList followers={followers} />)
    const postsBtn = screen.getByRole('button', { name: /Posts/ })
    await user.click(postsBtn)
    const updatedBtn = screen.getByRole('button', { name: /Posts/ })
    expect(updatedBtn.textContent).toContain('↓')
  })

  it('renders follower stats', () => {
    render(<FollowerList followers={[followers[1]]} />)
    expect(screen.getByText('5.0K followers')).toBeInTheDocument()
    expect(screen.getByText('200 posts')).toBeInTheDocument()
    expect(screen.getByText('100 following')).toBeInTheDocument()
  })

  it('renders follower description', () => {
    render(<FollowerList followers={[followers[0]]} />)
    expect(screen.getByText('Loves coding')).toBeInTheDocument()
  })
})
