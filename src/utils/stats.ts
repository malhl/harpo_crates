/**
 * utils/stats.ts — Aggregate statistics computation and number formatting.
 *
 * Computes summary statistics from the full list of enriched followers.
 * These stats are displayed in the overview cards at the top of the dashboard.
 */

import type { EnrichedFollower, FollowerStats } from '../types'

/**
 * Computes aggregate statistics across all enriched followers.
 *
 * @param followers - The full array of enriched followers
 * @param mutualDids - Set of DIDs that the target user follows back
 */
export function computeStats(followers: EnrichedFollower[], mutualDids: Set<string> = new Set()): FollowerStats {
  const total = followers.length
  if (total === 0) {
    return {
      totalFollowers: 0,
      totalMutuals: 0,
      avgFollowersOfFollowers: 0,
      avgPostsOfFollowers: 0,
    }
  }

  const totalMutuals = followers.filter(f => mutualDids.has(f.did)).length
  const avgFollowersOfFollowers = Math.round(
    followers.reduce((sum, f) => sum + f.followersCount, 0) / total
  )
  const avgPostsOfFollowers = Math.round(
    followers.reduce((sum, f) => sum + f.postsCount, 0) / total
  )

  return {
    totalFollowers: total,
    totalMutuals,
    avgFollowersOfFollowers,
    avgPostsOfFollowers,
  }
}

/**
 * Formats a number for compact display in the UI.
 * Numbers >= 1M display as "1.2M", >= 1K display as "1.2K",
 * smaller numbers display as-is.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}
