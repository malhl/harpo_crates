/**
 * types/index.ts — Central type definitions for Harpo Crates.
 *
 * Re-exports the Bluesky AT Protocol profile types and defines the
 * application's own domain types for enriched followers, analysis
 * progress tracking, and computed statistics.
 */

import type { AppBskyActorDefs } from '@atproto/api'

// Re-export the AT Protocol profile types so the rest of the app imports from here
// rather than depending directly on @atproto/api internals.
export type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed
export type ProfileView = AppBskyActorDefs.ProfileView

/**
 * A follower profile enriched with full stats from the getProfiles endpoint.
 */
export interface EnrichedFollower {
  did: string
  handle: string
  displayName: string
  avatar?: string
  description?: string
  followersCount: number
  followsCount: number
  postsCount: number
  createdAt?: string
  indexedAt?: string
  /** Position in the getFollowers results (0 = most recent, higher = followed longer ago) */
  followerIndex: number
  /** Bidirectional interaction score (likes, replies, quotes, reposts). 0 = not scored or no interactions */
  interactionScore: number
  /** Number of accounts this follower follows that the target also follows */
  sharedFollowsCount: number
}

/**
 * Tracks the current phase and progress of the multi-step analysis pipeline.
 * Phase flow: idle → profile → followers → following → enriching → done
 * On error, the phase jumps to 'error' from any step.
 */
export interface AnalysisProgress {
  phase: 'idle' | 'profile' | 'followers' | 'following' | 'enriching' | 'interactions' | 'connections' | 'done' | 'error'
  /** API calls completed so far */
  current: number
  /** Estimated total API calls */
  total: number
  message: string
  /** Locked time estimate in seconds, computed after the fast phases */
  estimatedSeconds?: number
}

/**
 * The complete output of the analysis pipeline.
 */
export interface AnalysisResult {
  profile: ProfileViewDetailed
  followers: EnrichedFollower[]
  mutualDids: Set<string>
  stats: FollowerStats
  /** How long the analysis took, in seconds */
  elapsedSeconds: number
  /** Total API calls made during the analysis */
  apiCalls: number
}

/**
 * Aggregate statistics computed from the full list of enriched followers.
 */
export interface FollowerStats {
  totalFollowers: number
  totalMutuals: number
  avgFollowersOfFollowers: number
  avgPostsOfFollowers: number
}

export interface FollowerCategoryDef {
  id: string
  label: string
  description: string
  filter: (f: EnrichedFollower) => boolean
  sortKey?: keyof Pick<EnrichedFollower, 'postsCount' | 'followersCount' | 'followsCount' | 'followerIndex'>
  sortFn?: (a: EnrichedFollower, b: EnrichedFollower) => number
  sortAsc?: boolean
  limit?: number
}

/** Returns the age of an account in milliseconds, or 0 if createdAt is missing */
function accountAgeMs(f: EnrichedFollower): number {
  return f.createdAt ? Date.now() - new Date(f.createdAt).getTime() : 0
}

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000
const SIX_MONTHS_MS = 6 * ONE_MONTH_MS

export const FOLLOWER_CATEGORIES: FollowerCategoryDef[] = [
  {
    id: 'besties',
    label: 'Besties',
    description: 'Followers you interact with most — scored by mutual replies, quotes & reposts over the last 6 months',
    filter: (f) => f.interactionScore > 0,
    sortFn: (a, b) => a.interactionScore - b.interactionScore,
    sortAsc: false, // highest score first
  },
  {
    id: 'inner-circle',
    label: 'Inner Circle',
    description: 'Followers who share the most follows with you — ranked by number of accounts you both follow',
    filter: (f) => f.sharedFollowsCount > 0,
    sortFn: (a, b) => a.sharedFollowsCount - b.sharedFollowsCount,
    sortAsc: false,
    limit: 20,
  },
  {
    id: 'lurkers',
    label: 'Lurkers',
    description: '<100 posts & 6+ months old, or <10 posts & 1+ month old',
    filter: (f) => {
      if (f.interactionScore > 0) return false
      const age = accountAgeMs(f)
      return (f.postsCount < 100 && age > SIX_MONTHS_MS)
          || (f.postsCount < 10 && age > ONE_MONTH_MS)
    },
    sortKey: 'followerIndex',
    sortAsc: false,
    limit: 50,
  },
]
