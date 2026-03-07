import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfileSummary } from './ProfileSummary'
import { makeProfile } from '../test/fixtures'

describe('ProfileSummary', () => {
  it('renders display name and handle', () => {
    const profile = makeProfile({ displayName: 'Alice', handle: 'alice.bsky.social' })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('@alice.bsky.social')).toBeInTheDocument()
  })

  it('falls back to handle when displayName is empty', () => {
    const profile = makeProfile({ displayName: '', handle: 'noname.bsky.social' })
    render(<ProfileSummary profile={profile} />)
    // The h2 should show the handle as fallback
    expect(screen.getByText('noname.bsky.social')).toBeInTheDocument()
  })

  it('renders bio text', () => {
    const profile = makeProfile({ description: 'Hello, I love Bluesky!' })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('Hello, I love Bluesky!')).toBeInTheDocument()
  })

  it('does not render bio section when description is undefined', () => {
    const profile = makeProfile({ description: undefined })
    render(<ProfileSummary profile={profile} />)
    // No paragraph for bio should be present
    expect(screen.queryByText(/hello/i)).not.toBeInTheDocument()
  })

  it('renders formatted follower count', () => {
    const profile = makeProfile({ followersCount: 12500 })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('12.5K')).toBeInTheDocument()
    expect(screen.getByText('followers')).toBeInTheDocument()
  })

  it('renders formatted following count', () => {
    const profile = makeProfile({ followsCount: 250 })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('following')).toBeInTheDocument()
  })

  it('renders formatted post count', () => {
    const profile = makeProfile({ postsCount: 1500000 })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('1.5M')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('renders avatar image when available', () => {
    const profile = makeProfile({ avatar: 'https://example.com/avatar.jpg', displayName: 'Bob' })
    render(<ProfileSummary profile={profile} />)
    // Avatar uses displayName ?? handle as alt text
    const imgs = screen.getAllByRole('img')
    const avatarImg = imgs.find(img => img.getAttribute('src') === 'https://example.com/avatar.jpg')
    expect(avatarImg).toBeInTheDocument()
  })

  it('renders placeholder when no avatar', () => {
    const profile = makeProfile({ avatar: undefined })
    render(<ProfileSummary profile={profile} />)
    // Should not find an img for avatar, but should render the placeholder div
    expect(screen.queryByRole('img', { name: /avatar/i })).not.toBeInTheDocument()
  })

  it('renders banner image when available', () => {
    const profile = makeProfile({ banner: 'https://example.com/banner.jpg' })
    const { container } = render(<ProfileSummary profile={profile} />)
    const bannerImg = container.querySelector('img[src="https://example.com/banner.jpg"]')
    expect(bannerImg).toBeInTheDocument()
  })

  it('renders join date', () => {
    const profile = makeProfile({ createdAt: '2024-06-15T12:00:00.000Z' })
    render(<ProfileSummary profile={profile} />)
    expect(screen.getByText('Joined')).toBeInTheDocument()
    // The exact date format depends on locale, so just check year is present
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })

  it('does not render join date when createdAt is undefined', () => {
    const profile = makeProfile({ createdAt: undefined })
    render(<ProfileSummary profile={profile} />)
    expect(screen.queryByText('Joined')).not.toBeInTheDocument()
  })
})
