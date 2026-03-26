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
import type { ProfileViewDetailed } from '../types'
import { debugLog } from '../utils/debug'

/**
 * Singleton AT Protocol agent configured to use the public (unauthenticated)
 * Bluesky API host. This host includes server-side caching and is the
 * recommended endpoint for read-only, unauthenticated app.bsky.* requests.
 */
const agent = new Agent({ service: 'https://public.api.bsky.app' })

/** Simple promise-based delay for rate limiting between API calls */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Abort checker type — returns true if the operation should stop */
export type IsAborted = () => boolean

class AbortedError extends Error {
  constructor() { super('Analysis timed out — took too long relative to the estimate. Try again or try a smaller account.') }
}

/** Throws AbortedError if the abort signal is set */
function checkAborted(isAborted?: IsAborted) {
  if (isAborted?.()) throw new AbortedError()
}

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
/** Slim follower record — only the fields we actually use downstream */
export interface SlimProfile {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  description?: string
}

export async function getAllFollowers(
  handle: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<SlimProfile[]> {
  const followers: SlimProfile[] = []
  let cursor: string | undefined

  do {
    const res = await agent.getFollowers({ actor: handle, limit: 100, cursor })
    for (const f of res.data.followers) {
      followers.push({ did: f.did, handle: f.handle, displayName: f.displayName, avatar: f.avatar, description: f.description })
    }
    const total = (res.data.subject as any).followersCount ?? followers.length
    onProgress(followers.length, total)
    cursor = res.data.cursor
    if (cursor) await delay(200)
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
): Promise<string[]> {
  const dids: string[] = []
  let cursor: string | undefined

  do {
    const res = await agent.getFollows({ actor: handle, limit: 100, cursor })
    for (const f of res.data.follows) {
      dids.push(f.did)
    }
    const total = (res.data.subject as any).followsCount ?? dids.length
    onProgress(dids.length, total)
    cursor = res.data.cursor
    if (cursor) await delay(200)
  } while (cursor)

  return dids
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
/** Slim enriched data — only the stats fields we actually need */
export interface SlimEnriched {
  displayName?: string
  avatar?: string
  description?: string
  followersCount: number
  followsCount: number
  postsCount: number
  createdAt?: string
  indexedAt?: string
}

export async function enrichProfiles(
  dids: string[],
  onProgress: (loaded: number, total: number) => void,
  isAborted?: IsAborted,
): Promise<Map<string, SlimEnriched>> {
  const profiles = new Map<string, SlimEnriched>()
  const batchSize = 25

  for (let i = 0; i < dids.length; i += batchSize) {
    checkAborted(isAborted)
    const batch = dids.slice(i, i + batchSize)
    const res = await agent.getProfiles({ actors: batch })
    for (const p of res.data.profiles) {
      profiles.set(p.did, {
        displayName: p.displayName,
        avatar: p.avatar,
        description: p.description,
        followersCount: p.followersCount ?? 0,
        followsCount: p.followsCount ?? 0,
        postsCount: p.postsCount ?? 0,
        createdAt: p.createdAt,
        indexedAt: p.indexedAt,
      })
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
  isAborted?: IsAborted,
): Promise<Map<string, number>> {
  const sharedCounts = new Map<string, number>()
  let pagesDone = 0
  let followersDone = 0
  const CONCURRENCY = 3
  const MAX_PAGES_PER_MUTUAL = 30 // Cap at ~3000 follows checked per mutual

  const processFollower = async (followerDid: string) => {
    let count = 0
    let cursor: string | undefined
    let pages = 0

    do {
      checkAborted(isAborted)
      let res
      try {
        res = await agent.getFollows({ actor: followerDid, limit: 100, cursor })
      } catch (err: any) {
        debugLog('error:getFollows', { actor: followerDid, message: err?.message })
        break
      }

      for (const follow of res.data.follows) {
        if (targetFollowingDids.has(follow.did)) {
          count++
        }
      }

      pagesDone++
      pages++
      cursor = res.data.cursor
      if (!cursor || pages >= MAX_PAGES_PER_MUTUAL) break
      await delay(200)
    } while (true)

    if (count > 0) {
      sharedCounts.set(followerDid, count)
    }
    followersDone++
    onProgress(pagesDone, `Seeing who runs in the same circles (${followersDone}/${followerDids.length})...`)
  }

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

/**
 * Fetches up to `maxPages` pages of posts for location inference.
 * Returns the post texts and their timestamps (indexedAt).
 */
export async function fetchPostsForLocation(
  handle: string,
  onProgress: (loaded: number) => void,
  maxPages = 10,
): Promise<{ texts: string[]; timestamps: string[] }> {
  const texts: string[] = []
  const timestamps: string[] = []
  let cursor: string | undefined
  let pages = 0

  do {
    const res = await agent.getAuthorFeed({
      actor: handle,
      limit: 100,
      cursor,
      filter: 'posts_and_author_threads',
    })
    for (const item of res.data.feed) {
      // Only include the user's own posts (skip reposts)
      if (item.post.author.handle === handle || item.post.author.did === handle) {
        const record = item.post.record as any
        if (record?.text) {
          texts.push(record.text)
          timestamps.push(item.post.indexedAt)
        }
      }
    }
    pages++
    onProgress(texts.length)
    cursor = res.data.cursor
    if (!cursor || pages >= maxPages) break
    await delay(200)
  } while (true)

  return { texts, timestamps }
}

/** Scoring weights for interaction types */
const WEIGHTS = { like: 1, repost: 2, reply: 3, quote: 3 }

/**
 * Computes bidirectional interaction scores using a 3-phase algorithm:
 *
 * Phase 1 — Incoming: Fetch the target's posts from the last 6 months and score
 * everyone who replied, reposted, or quote-posted them. (Likes are skipped here
 * as the weakest signal to reduce API calls.) Take the top 100 scorers as "friends."
 *
 * Phase 2 — Outgoing: For each friend, fetch their posts from the last 6 months
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
  isAborted?: IsAborted,
): Promise<{ scores: Map<string, number>; interactedDids: Set<string> }> {
  let completed = 0
  const SIX_MONTHS_AGO = Date.now() - 183 * 24 * 60 * 60 * 1000

  const addScore = (map: Map<string, number>, d: string, points: number) => {
    if (d && d !== did) map.set(d, (map.get(d) ?? 0) + points)
  }

  // ── Phase 1: Incoming — score everyone who interacted with the target ──

  // 1a. Fetch target's feed for the last 6 months.
  // We extract only the fields we need to avoid holding full API responses in memory.
  interface SlimFeedItem {
    postUri: string
    authorDid: string
    isRepost: boolean
    replyParentDid?: string
    embedType?: string
    quotedDid?: string
    rootUri?: string
  }
  const targetFeedItems: SlimFeedItem[] = []
  let cursor: string | undefined
  let reachedCutoff = false

  do {
    checkAborted(isAborted)
    const res = await agent.getAuthorFeed({
      actor: did,
      limit: 100,
      cursor,
      filter: 'posts_with_replies',
    })
    for (const item of res.data.feed) {
      const postDate = new Date(item.post.indexedAt).getTime()
      if (postDate < SIX_MONTHS_AGO) {
        reachedCutoff = true
        break
      }
      const embed = item.post.embed as any
      let embedType: string | undefined
      let quotedDid: string | undefined
      if (embed?.$type === 'app.bsky.embed.record#view') {
        embedType = embed.$type
        quotedDid = embed.record?.author?.did
      } else if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') {
        embedType = embed.$type
        quotedDid = embed.record?.record?.author?.did
      }
      targetFeedItems.push({
        postUri: item.post.uri,
        authorDid: item.post.author.did,
        isRepost: !!item.reason,
        replyParentDid: (item.reply as any)?.parent?.author?.did,
        embedType,
        quotedDid,
        rootUri: (item.reply as any)?.root?.uri,
      })
    }
    cursor = res.data.cursor
    completed++
    onProgress(completed, `Pulling up their posts...`)
    if (!cursor || reachedCutoff) break
    await delay(200)
  } while (true)

  // Collect target's original post URIs (not reposts)
  const targetPostUris: string[] = []
  for (const item of targetFeedItems) {
    if (item.authorDid === did && !item.isRepost) {
      targetPostUris.push(item.postUri)
    }
  }

  // 1b. For each target post, fetch who replied and reposted it.
  // Likes are skipped here (weight=1, weakest signal) to cut API calls by 1/3.
  // Likes are still checked in Phase 2b for outgoing scoring.
  const incomingScores = new Map<string, number>()
  const POST_BATCH = 3

  for (let pi = 0; pi < targetPostUris.length; pi += POST_BATCH) {
    checkAborted(isAborted)
    const batch = targetPostUris.slice(pi, pi + POST_BATCH)

    const batchResults = await Promise.allSettled(
      batch.flatMap(uri => [
        agent.getPostThread({ uri, depth: 1, parentHeight: 0 }),
        agent.getRepostedBy({ uri, limit: 100 }),
      ])
    )

    // Process results in groups of 2 (thread, reposts per post)
    for (let bi = 0; bi < batch.length; bi++) {
      const threadRes = batchResults[bi * 2]
      const repostsRes = batchResults[bi * 2 + 1]

      if (threadRes.status === 'fulfilled') {
        const thread = (threadRes.value as any).data.thread
        if (thread?.replies) {
          for (const reply of thread.replies) {
            addScore(incomingScores, reply?.post?.author?.did, WEIGHTS.reply)
          }
        }
      }
      if (repostsRes.status === 'fulfilled') {
        for (const profile of (repostsRes.value as any).data.repostedBy) {
          addScore(incomingScores, profile.did, WEIGHTS.repost)
        }
      }
    }

    completed += batch.length * 2
    onProgress(completed, `Seeing who shows up (${Math.min(pi + POST_BATCH, targetPostUris.length)}/${targetPostUris.length} posts)...`)
    if (pi + POST_BATCH < targetPostUris.length) await delay(200)
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
    if (item.replyParentDid && friendDids.has(item.replyParentDid)) {
      addScore(outgoingScores, item.replyParentDid, WEIGHTS.reply)
    }

    if (item.quotedDid && friendDids.has(item.quotedDid)) {
      addScore(outgoingScores, item.quotedDid, WEIGHTS.quote)
    }

    if (item.isRepost && friendDids.has(item.authorDid)) {
      addScore(outgoingScores, item.authorDid, WEIGHTS.repost)
    }
  }

  // Pre-compute thread data before clearing targetFeedItems
  const targetRepliesByRoot = new Map<string, number>()
  for (const item of targetFeedItems) {
    if (item.rootUri && item.authorDid === did) {
      targetRepliesByRoot.set(item.rootUri, (targetRepliesByRoot.get(item.rootUri) ?? 0) + 1)
    }
  }

  // Free the feed items array — no longer needed
  targetFeedItems.length = 0

  // 2b. For each friend, fetch their posts and check getLikes for the target's outgoing likes
  // Process friends fully sequentially — one at a time to limit peak memory
  let friendsDone = 0

  for (const [friendDid] of friends) {
    let friendCursor: string | undefined
    let friendCutoff = false

    do {
      checkAborted(isAborted)
      let feedRes
      try {
        feedRes = await agent.getAuthorFeed({
          actor: friendDid,
          limit: 100,
          cursor: friendCursor,
          filter: 'posts_no_replies',
        })
      } catch (err: any) {
        debugLog('error:getAuthorFeed', { actor: friendDid, message: err?.message })
        break
      }
      completed++ // getAuthorFeed call

      // Collect post URIs from this page that need like-checking
      const postUris: string[] = []
      for (const item of feedRes.data.feed) {
        const postDate = new Date(item.post.indexedAt).getTime()
        if (postDate < SIX_MONTHS_AGO) {
          friendCutoff = true
          break
        }
        if (item.post.author.did === friendDid && !item.reason) {
          postUris.push(item.post.uri)
        }
      }

      friendCursor = feedRes.data.cursor

      // Check likes in batches of 5
      const LIKE_BATCH = 5
      for (let li = 0; li < postUris.length; li += LIKE_BATCH) {
        const batch = postUris.slice(li, li + LIKE_BATCH)
        const likeResults = await Promise.allSettled(
          batch.map(uri => agent.getLikes({ uri, limit: 100 }))
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
        completed += batch.length
        if (li + LIKE_BATCH < postUris.length) await delay(200)
      }

      onProgress(completed, `Checking if the love goes both ways (${friendsDone + 1}/${friends.length})...`)
      if (!friendCursor || friendCutoff) break
      await delay(200)
    } while (true)
    friendsDone++
  }

  // ── Thread Bonus: Detect long threads between target and others ──
  // (targetRepliesByRoot was pre-computed above before clearing targetFeedItems)

  // Find roots where target replied 3+ times
  const longThreadRoots = [...targetRepliesByRoot.entries()]
    .filter(([, count]) => count >= 3)
    .map(([uri, count]) => ({ uri, targetReplies: count }))

  // Fetch each thread and count per-author replies
  const threadBonus = new Map<string, number>()
  for (let ti = 0; ti < longThreadRoots.length; ti++) {
    checkAborted(isAborted)
    const { uri, targetReplies } = longThreadRoots[ti]
    let threadRes
    try {
      threadRes = await agent.getPostThread({ uri, depth: 100, parentHeight: 0 })
    } catch (err: any) {
      debugLog('error:getPostThread', { uri, message: err?.message })
      continue
    }

    // Walk the thread tree and count replies per non-target author
    const replyCounts = new Map<string, number>()
    const walkThread = (node: any) => {
      if (node?.post?.author?.did && node.post.author.did !== did) {
        replyCounts.set(node.post.author.did, (replyCounts.get(node.post.author.did) ?? 0) + 1)
      }
      if (node?.replies) {
        for (const reply of node.replies) walkThread(reply)
      }
    }
    walkThread(threadRes.data.thread)

    // For each person who also replied 3+ times, add 10 * (extra replies each)
    for (const [authorDid, count] of replyCounts) {
      if (count >= 3) {
        const bonus = 10 * ((targetReplies - 3) + (count - 3))
        threadBonus.set(authorDid, (threadBonus.get(authorDid) ?? 0) + bonus)
      }
    }

    completed++
    onProgress(completed, `Checking for long threads (${ti + 1}/${longThreadRoots.length})...`)
    await delay(200)
  }

  // ── Phase 3: Closeness-weighted combination ──
  // Geometric mean sqrt(incoming * outgoing) favors balanced mutual interaction,
  // plus bonus points for long threads
  const combined = new Map<string, number>()
  for (const [d, incoming] of friends) {
    const outgoing = outgoingScores.get(d) ?? 0
    if (outgoing > 0) {
      combined.set(d, Math.sqrt(incoming * outgoing) + (threadBonus.get(d) ?? 0))
    } else if (threadBonus.has(d)) {
      combined.set(d, threadBonus.get(d)!)
    }
  }
  // Also add anyone with thread bonus who wasn't in the top 100 friends
  for (const [d, bonus] of threadBonus) {
    if (!combined.has(d)) {
      combined.set(d, bonus)
    }
  }

  const sorted = [...combined.entries()].sort((a, b) => b[1] - a[1])

  // Return top 20 scores for display, plus all DIDs that had any interaction
  // with the target in the last 6 months (used to exclude them from ghosts)
  const interactedDids = new Set(incomingScores.keys())
  return { scores: new Map(sorted.slice(0, 20)), interactedDids }
}
