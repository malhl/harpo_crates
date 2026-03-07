import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FollowerDashboard } from './FollowerDashboard'
import { makeProfile, makeFollower } from '../test/fixtures'
import type { AnalysisResult } from '../types'

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const followers = [
    makeFollower({ did: 'did:1', handle: 'alice.bsky.social', displayName: 'Alice', followersCount: 500, postsCount: 200 }),
    makeFollower({ did: 'did:2', handle: 'bob.bsky.social', displayName: 'Bob', followersCount: 50000, postsCount: 5000 }),
    makeFollower({ did: 'did:3', handle: 'charlie.bsky.social', displayName: 'Charlie', followersCount: 10, postsCount: 3 }),
  ]

  return {
    profile: makeProfile(),
    followers,
    mutualDids: new Set(['did:1']),
    stats: {
      totalFollowers: 3,
      totalMutuals: 1,
      avgFollowersOfFollowers: 16837,
      avgPostsOfFollowers: 1734,
    },
    ...overrides,
  }
}

describe('FollowerDashboard', () => {
  it('renders overview stat cards', () => {
    render(<FollowerDashboard result={makeResult()} />)
    expect(screen.getByText('Total Followers')).toBeInTheDocument()
    expect(screen.getByText('Mutuals')).toBeInTheDocument()
    expect(screen.getByText('Avg Followers')).toBeInTheDocument()
    expect(screen.getByText('Avg Posts')).toBeInTheDocument()
  })

  it('renders follower list heading', () => {
    render(<FollowerDashboard result={makeResult()} />)
    expect(screen.getByText('All Followers')).toBeInTheDocument()
  })

  it('renders all followers', () => {
    render(<FollowerDashboard result={makeResult()} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('renders formatted stat values', () => {
    render(<FollowerDashboard result={makeResult()} />)
    expect(screen.getByText('3')).toBeInTheDocument() // totalFollowers
    expect(screen.getByText('1')).toBeInTheDocument() // totalMutuals
    expect(screen.getByText('16.8K')).toBeInTheDocument() // avgFollowers
    expect(screen.getByText('1.7K')).toBeInTheDocument() // avgPosts
  })
})
