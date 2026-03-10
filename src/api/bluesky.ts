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
    const total = (res.data.subject as any).followersCount ?? followers.length
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
    const total = (res.data.subject as any).followsCount ?? following.length
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

/**
 * Computes how many of the target's follows each follower also follows.
 * Fetches each follower's following list and intersects with the target's.
 * Processes up to 3 followers concurrently for speed.
 *
 * @param followerDids - DIDs of all followers to check
 * @param targetFollowingDids - Set of DIDs the target user follows
 * @param onProgress - Called with (completed, message) after each follower
 * @returns Map of follower DID → shared follow count
 */
export async function computeSharedFollows(
  followerDids: string[],
  targetFollowingDids: Set<string>,
  onProgress: (completed: number, message: string) => void,
): Promise<Map<string, number>> {
  const sharedCounts = new Map<string, number>()
  let done = 0
  const CONCURRENCY = 3

  const processFollower = async (followerDid: string) => {
    let count = 0
    let cursor: string | undefined

    do {
      let res
      try {
        res = await agent.getFollows({ actor: followerDid, limit: 100, cursor })
      } catch { break }

      for (const follow of res.data.follows) {
        if (targetFollowingDids.has(follow.did)) {
          count++
        }
      }

      cursor = res.data.cursor
      if (!cursor) break
      await delay(200)
    } while (true)

    if (count > 0) {
      sharedCounts.set(followerDid, count)
    }
    done++
    onProgress(done, `Comparing follows (${done}/${followerDids.length})...`)
  }

  // Run through a concurrency pool
  const pool: Promise<void>[] = []
  for (const did of followerDids) {
    const p = processFollower(did)
    pool.push(p)
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool)
      for (let i = pool.length - 1; i >= 0; i--) {
        const settled = await Promise.race([pool[i].then(() => true), Promise.resolve(false)])
        if (settled) pool.splice(i, 1)
      }
    }
  }
  await Promise.all(pool)

  return sharedCounts
}

/** Scoring weights for interaction types */
const WEIGHTS = { like: 1, repost: 2, reply: 3, quote: 3 }

/**
 * Computes bidirectional interaction scores using a 3-phase algorithm:
 *
 * Phase 1 — Incoming: Fetch the target's posts from the last year and score
 * everyone who liked, replied, reposted, or quote-posted them. Take the top
 * 100 scorers as "friends."
 *
 * Phase 2 — Outgoing: For each friend, fetch their posts from the last year
 * and score based on how much the target replied, reposted, quote-posted, or
 * liked those friends' posts.
 *
 * Phase 3 — Closeness: Combine the incoming and outgoing scores using a
 * geometric mean (sqrt(incoming * outgoing)) which favors balanced, mutual
 * interaction. Return the top 20.
 *
 * @param did - The target user's DID
 * @param onProgress - Called after each API call with (completedCalls)
 * @returns Map of DID → interaction score for the top 20 interactors
 */
export async function computeBestieScores(
  did: string,
  onProgress: (completed: number, message: string) => void,
): Promise<Map<string, number>> {
  let completed = 0
  const ONE_YEAR_AGO = Date.now() - 365 * 24 * 60 * 60 * 1000

  const addScore = (map: Map<string, number>, d: string, points: number) => {
    if (d && d !== did) map.set(d, (map.get(d) ?? 0) + points)
  }

  // ── Phase 1: Incoming — score everyone who interacted with the target ──

  // 1a. Fetch target's feed for the last year to collect their post URIs
  const targetFeedItems: any[] = []
  let cursor: string | undefined
  let reachedCutoff = false

  do {
    const res = await agent.getAuthorFeed({
      actor: did,
      limit: 100,
      cursor,
      filter: 'posts_with_replies',
    })
    for (const item of res.data.feed) {
      const postDate = new Date(item.post.indexedAt).getTime()
      if (postDate < ONE_YEAR_AGO) {
        reachedCutoff = true
        break
      }
      targetFeedItems.push(item)
    }
    cursor = res.data.cursor
    completed++
    onProgress(completed, `Fetching your posts...`)
    if (!cursor || reachedCutoff) break
    await delay(200)
  } while (true)

  // Collect target's original post URIs (not reposts)
  const targetPostUris: string[] = []
  for (const item of targetFeedItems) {
    if (item.post.author.did === did && !item.reason) {
      targetPostUris.push(item.post.uri)
    }
  }

  // 1b. For each target post, fetch who liked, replied, and reposted it (3 calls in parallel per post)
  const incomingScores = new Map<string, number>()

  for (let pi = 0; pi < targetPostUris.length; pi++) {
    const uri = targetPostUris[pi]

    const [likesRes, threadRes, repostsRes] = await Promise.allSettled([
      agent.getLikes({ uri, limit: 100 }),
      agent.getPostThread({ uri, depth: 1, parentHeight: 0 }),
      agent.getRepostedBy({ uri, limit: 100 }),
    ])

    if (likesRes.status === 'fulfilled') {
      for (const like of likesRes.value.data.likes) {
        addScore(incomingScores, like.actor.did, WEIGHTS.like)
      }
    }
    if (threadRes.status === 'fulfilled') {
      const thread = threadRes.value.data.thread as any
      if (thread?.replies) {
        for (const reply of thread.replies) {
          addScore(incomingScores, reply?.post?.author?.did, WEIGHTS.reply)
        }
      }
    }
    if (repostsRes.status === 'fulfilled') {
      for (const profile of repostsRes.value.data.repostedBy) {
        addScore(incomingScores, profile.did, WEIGHTS.repost)
      }
    }

    completed++
    onProgress(completed, `Scoring incoming interactions (${pi + 1}/${targetPostUris.length} posts)...`)
    await delay(200)
  }

  // Take top 100 incoming scorers as "friends"
  const TOP_FRIENDS = 100
  const sortedIncoming = [...incomingScores.entries()].sort((a, b) => b[1] - a[1])
  const friends = sortedIncoming.slice(0, TOP_FRIENDS)
  const friendDids = new Set(friends.map(([d]) => d))

  // ── Phase 2: Outgoing — score how much the target interacts with each friend ──

  const outgoingScores = new Map<string, number>()

  // 2a. Extract outgoing replies, quotes, and reposts from the target's feed (already fetched)
  for (const item of targetFeedItems) {
    const parentDid = (item.reply as any)?.parent?.author?.did
    if (parentDid && friendDids.has(parentDid)) {
      addScore(outgoingScores, parentDid, WEIGHTS.reply)
    }

    const embed = item.post.embed as any
    if (embed?.$type === 'app.bsky.embed.record#view') {
      const quotedDid = embed.record?.author?.did
      if (quotedDid && friendDids.has(quotedDid)) {
        addScore(outgoingScores, quotedDid, WEIGHTS.quote)
      }
    }
    if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') {
      const quotedDid = embed.record?.record?.author?.did
      if (quotedDid && friendDids.has(quotedDid)) {
        addScore(outgoingScores, quotedDid, WEIGHTS.quote)
      }
    }

    if (item.reason?.$type === 'app.bsky.feed.defs#reasonRepost') {
      const repostedDid = item.post.author.did
      if (friendDids.has(repostedDid)) {
        addScore(outgoingScores, repostedDid, WEIGHTS.repost)
      }
    }
  }

  // 2b. For each friend, fetch their posts and check getLikes for the target's outgoing likes
  // Process up to 3 friends concurrently to stay within rate limits
  const CONCURRENCY = 3
  let friendsDone = 0

  const processFriend = async (friendDid: string) => {
    let friendCursor: string | undefined
    let friendCutoff = false

    do {
      let feedRes
      try {
        feedRes = await agent.getAuthorFeed({
          actor: friendDid,
          limit: 100,
          cursor: friendCursor,
          filter: 'posts_no_replies',
        })
      } catch { break }

      // Collect post URIs from this page that need like-checking
      const postUris: string[] = []
      for (const item of feedRes.data.feed) {
        const postDate = new Date(item.post.indexedAt).getTime()
        if (postDate < ONE_YEAR_AGO) {
          friendCutoff = true
          break
        }
        if (item.post.author.did === friendDid && !item.reason) {
          postUris.push(item.post.uri)
        }
      }

      // Check likes on all posts from this page in parallel
      const likeResults = await Promise.allSettled(
        postUris.map(uri => agent.getLikes({ uri, limit: 100 }))
      )
      for (const res of likeResults) {
        if (res.status === 'fulfilled') {
          for (const like of res.value.data.likes) {
            if (like.actor.did === did) {
              addScore(outgoingScores, friendDid, WEIGHTS.like)
              break
            }
          }
        }
      }

      friendCursor = feedRes.data.cursor
      completed++
      friendsDone++
      onProgress(completed, `Checking outgoing interactions (${friendsDone}/${friends.length} people)...`)
      if (!friendCursor || friendCutoff) break
      await delay(200)
    } while (true)
  }

  // Run friends through a concurrency pool
  const friendQueue = friends.map(([d]) => d)
  const pool: Promise<void>[] = []
  for (const friendDid of friendQueue) {
    const p = processFriend(friendDid)
    pool.push(p)
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool)
      // Remove settled promises from the pool
      for (let i = pool.length - 1; i >= 0; i--) {
        const settled = await Promise.race([pool[i].then(() => true), Promise.resolve(false)])
        if (settled) pool.splice(i, 1)
      }
    }
  }
  await Promise.all(pool)

  // ── Phase 3: Closeness-weighted combination ──
  // Geometric mean sqrt(incoming * outgoing) favors balanced mutual interaction
  const combined = new Map<string, number>()
  for (const [d, incoming] of friends) {
    const outgoing = outgoingScores.get(d) ?? 0
    if (outgoing > 0) {
      combined.set(d, Math.sqrt(incoming * outgoing))
    }
  }

  const sorted = [...combined.entries()].sort((a, b) => b[1] - a[1])
  return new Map(sorted.slice(0, 20))
}
