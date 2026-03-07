import { describe, it, expect } from 'vitest'
import { computeStats, formatNumber } from './stats'
import { makeFollower, makeFollowers } from '../test/fixtures'

describe('computeStats', () => {
  it('returns zeros for empty follower list', () => {
    const stats = computeStats([])
    expect(stats.totalFollowers).toBe(0)
    expect(stats.totalMutuals).toBe(0)
    expect(stats.avgFollowersOfFollowers).toBe(0)
    expect(stats.avgPostsOfFollowers).toBe(0)
  })

  it('computes totalFollowers correctly', () => {
    const followers = makeFollowers(5)
    const stats = computeStats(followers)
    expect(stats.totalFollowers).toBe(5)
  })

  it('counts mutuals correctly using mutualDids set', () => {
    const followers = [
      makeFollower({ did: 'a' }),
      makeFollower({ did: 'b' }),
      makeFollower({ did: 'c' }),
    ]
    const mutualDids = new Set(['a', 'b'])
    const stats = computeStats(followers, mutualDids)
    expect(stats.totalMutuals).toBe(2)
  })

  it('computes average followers of followers correctly', () => {
    const followers = [
      makeFollower({ followersCount: 100 }),
      makeFollower({ followersCount: 200 }),
      makeFollower({ followersCount: 300 }),
    ]
    const stats = computeStats(followers)
    expect(stats.avgFollowersOfFollowers).toBe(200)
  })

  it('rounds average followers to nearest integer', () => {
    const followers = [
      makeFollower({ followersCount: 10 }),
      makeFollower({ followersCount: 11 }),
    ]
    const stats = computeStats(followers)
    expect(stats.avgFollowersOfFollowers).toBe(11)
  })

  it('computes average posts of followers correctly', () => {
    const followers = [
      makeFollower({ postsCount: 50 }),
      makeFollower({ postsCount: 150 }),
    ]
    const stats = computeStats(followers)
    expect(stats.avgPostsOfFollowers).toBe(100)
  })

  it('handles single follower', () => {
    const followers = [
      makeFollower({ followersCount: 42, postsCount: 10 }),
    ]
    const stats = computeStats(followers)
    expect(stats.totalFollowers).toBe(1)
    expect(stats.avgFollowersOfFollowers).toBe(42)
    expect(stats.avgPostsOfFollowers).toBe(10)
  })

  it('returns zero mutuals when no mutualDids provided', () => {
    const followers = makeFollowers(3)
    const stats = computeStats(followers)
    expect(stats.totalMutuals).toBe(0)
  })
})

describe('formatNumber', () => {
  it('returns raw number for values under 1000', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(1)).toBe('1')
    expect(formatNumber(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1.0K')
    expect(formatNumber(1500)).toBe('1.5K')
    expect(formatNumber(12345)).toBe('12.3K')
    expect(formatNumber(999999)).toBe('1000.0K')
  })

  it('formats millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1.0M')
    expect(formatNumber(2500000)).toBe('2.5M')
    expect(formatNumber(12345678)).toBe('12.3M')
  })

  it('uses one decimal place', () => {
    expect(formatNumber(1234)).toBe('1.2K')
    expect(formatNumber(1250000)).toBe('1.3M')
  })
})
