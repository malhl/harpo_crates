/**
 * api/bluesky.ts — Bluesky AT Protocol API service layer.
 *
 * This module wraps the @atproto/api SDK to provide higher-level functions
 * for the follower analysis pipeline. All functions call the public
 * unauthenticated endpoint at https://public.api.bsky.app, which does not
 * require any login or API key.
 *
 * Key design decisions:
 *   - Each paginated function accepts an `onProgress` callback so the UI
 *     can show real-time loading progress to the user.
 *   - A 200ms delay is inserted between API requests to stay well within
 *     the public API's rate limit (~3,000 requests per 5 minutes per IP).
 *   - The enrichProfiles function batches DIDs into groups of 25, which is
 *     the maximum allowed by the getProfiles endpoint.
 */

import { Agent } from '@atproto/api'
import type { ProfileViewDetailed, ProfileView } from '../types'

/**
 * Singleton AT Protocol agent configured to use the public (unauthenticated)
 * Bluesky API host. This host includes server-side caching and is the
 * recommended endpoint for read-only, unauthenticated app.bsky.* requests.
 */
const agent = new Agent({ service: 'https://public.api.bsky.app' })

/** Simple promise-based delay for rate limiting between API calls */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Fetches the full profile for a given Bluesky handle or DID.
 * Returns a ProfileViewDetailed which includes follower/following/post counts,
 * avatar, banner, bio, creation date, and other metadata.
 *
 * @param handle - A Bluesky handle (e.g. "user.bsky.social") or DID
 * @throws Error if the handle doesn't exist or the API is unreachable
 */
export async function getProfile(handle: string): Promise<ProfileViewDetailed> {
  const res = await agent.getProfile({ actor: handle })
  return res.data
}

/**
 * Fetches ALL followers for a given account by paginating through the
 * getFollowers endpoint. Each page returns up to 100 followers.
 *
 * The AT Protocol uses cursor-based pagination: each response includes an
 * opaque `cursor` string that, when passed in the next request, fetches
 * the next page. Pagination ends when no cursor is returned.
 *
 * Note: The follower count from the profile may differ from the actual
 * number of followers returned here, because deleted/suspended/blocked
 * accounts are excluded from paginated results.
 *
 * @param handle - The account whose followers to fetch
 * @param onProgress - Called after each page with (loaded, total) counts
 * @returns Array of ProfileView objects (lightweight profiles without full stats)
 */
export async function getAllFollowers(
  handle: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ProfileView[]> {
  const followers: ProfileView[] = []
  let cursor: string | undefined

  do {
    const res = await agent.getFollowers({ actor: handle, limit: 100, cursor })
    followers.push(...res.data.followers)
    // Use the subject's followersCount as the total estimate for the progress bar.
    // Fall back to the current loaded count if the count isn't available.
    const total = res.data.subject.followersCount ?? followers.length
    onProgress(followers.length, total)
    cursor = res.data.cursor
    if (cursor) await delay(200) // Rate limit: wait between pages
  } while (cursor)

  return followers
}

/**
 * Fetches ALL accounts that the given user follows, using the same
 * cursor-based pagination pattern as getAllFollowers.
 *
 * This data is used to determine mutual relationships: a follower is
 * a "mutual" if their DID appears in this following list.
 *
 * @param handle - The account whose following list to fetch
 * @param onProgress - Called after each page with (loaded, total) counts
 * @returns Array of ProfileView objects for each followed account
 */
export async function getAllFollowing(
  handle: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ProfileView[]> {
  const following: ProfileView[] = []
  let cursor: string | undefined

  do {
    const res = await agent.getFollows({ actor: handle, limit: 100, cursor })
    following.push(...res.data.follows)
    const total = res.data.subject.followsCount ?? following.length
    onProgress(following.length, total)
    cursor = res.data.cursor
    if (cursor) await delay(200)
  } while (cursor)

  return following
}

/**
 * Enriches a list of follower profiles by fetching their full ProfileViewDetailed
 * data (which includes follower/following/post counts that aren't available
 * in the lighter ProfileView returned by getFollowers).
 *
 * The getProfiles endpoint accepts up to 25 actor IDs per request, so this
 * function batches the DIDs into groups of 25 and processes them sequentially
 * with rate-limiting delays between batches.
 *
 * @param dids - Array of Decentralized Identifiers to enrich
 * @param onProgress - Called after each batch with (loaded, total) counts
 * @returns Map from DID → ProfileViewDetailed for quick lookup during categorization
 */
export async function enrichProfiles(
  dids: string[],
  onProgress: (loaded: number, total: number) => void,
): Promise<Map<string, ProfileViewDetailed>> {
  const profiles = new Map<string, ProfileViewDetailed>()
  const batchSize = 25 // Maximum allowed by the getProfiles endpoint

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize)
    const res = await agent.getProfiles({ actors: batch })
    for (const profile of res.data.profiles) {
      profiles.set(profile.did, profile)
    }
    onProgress(Math.min(i + batchSize, dids.length), dids.length)
    if (i + batchSize < dids.length) await delay(200)
  }

  return profiles
}
