/**
 * test/fixtures.ts — Shared test fixtures and mock data factories.
 */

import type { EnrichedFollower, ProfileViewDetailed } from '../types'

export function makeProfile(overrides: Partial<ProfileViewDetailed> = {}): ProfileViewDetailed {
  return {
    did: 'did:plc:test123',
    handle: 'test.bsky.social',
    displayName: 'Test User',
    description: 'Just a test account',
    avatar: 'https://example.com/avatar.jpg',
    banner: 'https://example.com/banner.jpg',
    followersCount: 100,
    followsCount: 50,
    postsCount: 200,
    createdAt: '2024-01-01T00:00:00.000Z',
    indexedAt: '2024-06-01T00:00:00.000Z',
    labels: [],
    ...overrides,
  } as ProfileViewDetailed
}

export function makeFollower(overrides: Partial<EnrichedFollower> = {}): EnrichedFollower {
  return {
    did: 'did:plc:follower1',
    handle: 'follower.bsky.social',
    displayName: 'Follower One',
    avatar: 'https://example.com/avatar.jpg',
    description: 'A follower',
    followersCount: 50,
    followsCount: 30,
    postsCount: 100,
    createdAt: '2024-01-01T00:00:00.000Z',
    indexedAt: '2024-06-01T00:00:00.000Z',
    followerIndex: 0,
    interactionScore: 0,
    ...overrides,
  }
}

export function makeFollowers(count: number, overrides: Partial<EnrichedFollower> = {}): EnrichedFollower[] {
  return Array.from({ length: count }, (_, i) =>
    makeFollower({
      did: `did:plc:follower${i}`,
      handle: `follower${i}.bsky.social`,
      displayName: `Follower ${i}`,
      ...overrides,
    })
  )
}
