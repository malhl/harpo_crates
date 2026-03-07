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
}

/**
 * Tracks the current phase and progress of the multi-step analysis pipeline.
 * Phase flow: idle → profile → followers → following → enriching → done
 * On error, the phase jumps to 'error' from any step.
 */
export interface AnalysisProgress {
  phase: 'idle' | 'profile' | 'followers' | 'following' | 'enriching' | 'done' | 'error'
  current: number
  total: number
  message: string
}

/**
 * The complete output of the analysis pipeline.
 */
export interface AnalysisResult {
  profile: ProfileViewDetailed
  followers: EnrichedFollower[]
  mutualDids: Set<string>
  stats: FollowerStats
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
