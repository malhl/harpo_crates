/**
 * hooks/useFollowerAnalysis.ts — Core analysis pipeline orchestrator.
 *
 * Manages the multi-step async pipeline:
 *   1. Profile lookup
 *   2. Follower fetch (paginated)
 *   3. Following fetch (for mutual detection)
 *   4. Profile enrichment (batch)
 *   5. Interaction scoring (besties)
 *   6. Shared follows (inner circle)
 *   7. Stats computation
 *
 * Progress uses a weighted virtual scale (0–1000) so the bar moves visibly:
 *   - Early phases (profile + followers + following) → 0–30% (0–300)
 *   - Heavy phases (enriching + interactions + connections) → 30–100% (300–1000)
 * After the fast phases, the observed rate is used to estimate total runtime.
 */

import { useState, useCallback, useRef } from 'react'
import { getProfile, getAllFollowers, getAllFollowing, enrichProfiles, computeBestieScores, computeSharedFollows, type IsAborted } from '../api/bluesky'
import { computeStats } from '../utils/stats'
import type { AnalysisProgress, AnalysisResult, EnrichedFollower } from '../types'

const INITIAL_PROGRESS: AnalysisProgress = {
  phase: 'idle',
  current: 0,
  total: 0,
  message: '',
}

export function useFollowerAnalysis() {
  const [progress, setProgress] = useState<AnalysisProgress>(INITIAL_PROGRESS)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const abort = useCallback(() => {
    abortRef.current = true
  }, [])

  const analyze = useCallback(async (handle: string) => {
    setResult(null)
    setError(null)
    abortRef.current = false

    const isAborted: IsAborted = () => abortRef.current
    const startTime = Date.now()

    try {
      // Weighted progress: early phases (profile+followers+following) = 0–30%,
      // heavy phases (enriching+interactions+connections) = 30–100%.
      // We use a virtual 1000-unit scale so the bar always moves visibly.
      const SCALE = 1000
      const EARLY_END = 300   // early phases fill 0–300
      const HEAVY_START = 300 // heavy phases fill 300–1000
      const HEAVY_RANGE = SCALE - HEAVY_START // 700

      const emit = (phase: AnalysisProgress['phase'], current: number, total: number, message: string, estimatedSeconds?: number) => {
        setProgress({ phase, current, total, message, estimatedSeconds })
      }

      // Step 1: Fetch the target user's profile
      emit('profile', 0, SCALE, 'Looking them up...')
      const profile = await getProfile(handle)

      // Estimate API calls per phase
      let estFollowers = profile.followersCount ?? 0
      let estFollows = profile.followsCount ?? 0
      const estPosts = Math.min(profile.postsCount ?? 0, 3650)

      let estFollowerPages = Math.ceil(estFollowers / 100) || 1
      const estFollowingPages = Math.ceil(estFollows / 100) || 1
      const estEnrichBatches = Math.ceil(estFollowers / 25) || 1

      const estFeedPages = Math.ceil(estPosts / 100) || 1
      const estPostCalls = estPosts * 3
      const estFriendCalls = Math.min(100, estFollowers) * 25
      const estThreadCalls = 20
      const estInteractionCalls = estFeedPages + estPostCalls + estFriendCalls + estThreadCalls
      const estConnectionPages = estFollowers * 2

      // Early phase: profile(1) + followerPages + followingPages
      const earlyTotal = 1 + estFollowerPages + estFollowingPages
      let earlyDone = 1 // profile done

      // Heavy phase totals (for mapping within 30–100%)
      let heavyTotal = estEnrichBatches + estInteractionCalls + estConnectionPages
      let heavyDone = 0

      // Helper: map early progress (0..earlyTotal) → (0..EARLY_END)
      const earlyProgress = () => Math.round((earlyDone / earlyTotal) * EARLY_END)
      // Helper: map heavy progress (0..heavyTotal) → (HEAVY_START..SCALE)
      const heavyProgress = () => HEAVY_START + Math.round((heavyDone / Math.max(1, heavyTotal)) * HEAVY_RANGE)

      // Step 2: Paginate through all followers
      emit('followers', earlyProgress(), SCALE, 'Rounding up followers...')
      const followers = await getAllFollowers(handle, (loaded) => {
        if (loaded > estFollowers) {
          const newPages = Math.ceil(loaded / 100)
          estFollowerPages = newPages
          estFollowers = loaded
        }
        const pagesSoFar = Math.ceil(loaded / 100)
        earlyDone = 1 + pagesSoFar
        emit('followers', earlyProgress(), SCALE, `Rounding up followers (${loaded}/${estFollowers})...`)
      })
      const actualFollowerPages = Math.ceil(followers.length / 100) || 1
      earlyDone = 1 + actualFollowerPages

      // Step 3: Fetch following list for mutual detection
      emit('following', earlyProgress(), SCALE, 'Checking who they follow...')
      const following = await getAllFollowing(handle, (loaded) => {
        const pagesSoFar = Math.ceil(loaded / 100)
        earlyDone = 1 + actualFollowerPages + pagesSoFar
        emit('following', earlyProgress(), SCALE, `Checking who they follow (${loaded}/${estFollows})...`)
      })
      const actualFollowingPages = Math.ceil(following.length / 100) || 1
      earlyDone = 1 + actualFollowerPages + actualFollowingPages
      const followingDids = new Set(following.map(f => f.did))

      // Recalculate heavy totals with actual follower count
      const actualEnrichBatches = Math.ceil(followers.length / 25) || 1
      const actualConnectionPages = followers.length * 2
      heavyTotal = actualEnrichBatches + estInteractionCalls + actualConnectionPages

      // Lock time estimate using observed sequential rate
      const elapsedMs = Date.now() - startTime
      const earlyCalls = 1 + actualFollowerPages + actualFollowingPages
      const msPerCall = elapsedMs / earlyCalls
      const remainingMs =
        actualEnrichBatches * msPerCall +
        estFeedPages * msPerCall +
        Math.ceil(estPosts / 3) * msPerCall +
        estFriendCalls * msPerCall / 3 +
        estThreadCalls * msPerCall +
        actualConnectionPages * msPerCall / 3
      const estimatedSeconds = Math.ceil((elapsedMs + remainingMs) / 1000)

      // Step 4: Enrich follower profiles with full stats
      const followerDids = followers.map(f => f.did)
      emit('enriching', HEAVY_START, SCALE, 'Getting the details...', estimatedSeconds)
      const enriched = await enrichProfiles(followerDids, (loaded) => {
        heavyDone = Math.ceil(loaded / 25)
        emit('enriching', heavyProgress(), SCALE, `Getting the details (${loaded}/${followerDids.length})...`, estimatedSeconds)
      }, isAborted)
      heavyDone = actualEnrichBatches

      // Step 5: Compute bestie interaction scores
      const interactionBase = heavyDone
      emit('interactions', heavyProgress(), SCALE, 'Finding the besties...', estimatedSeconds)
      let interactionCallsReported = 0
      const bestieScores = await computeBestieScores(profile.did, (apiCalls, message) => {
        interactionCallsReported = apiCalls
        heavyDone = interactionBase + apiCalls
        emit('interactions', heavyProgress(), SCALE, message, estimatedSeconds)
      }, isAborted)
      heavyDone = interactionBase + interactionCallsReported
      heavyTotal += (interactionCallsReported - estInteractionCalls) // adjust for actual

      // Step 6: Compute shared follows
      const connectionBase = heavyDone
      emit('connections', heavyProgress(), SCALE, 'Mapping the inner circle...', estimatedSeconds)
      const sharedFollows = await computeSharedFollows(followerDids, followingDids, (pages, message) => {
        heavyDone = connectionBase + pages
        emit('connections', heavyProgress(), SCALE, message, estimatedSeconds)
      }, isAborted)

      // Step 7: Map to EnrichedFollower objects
      const enrichedFollowers: EnrichedFollower[] = followers.map((f, i) => {
        const detailed = enriched.get(f.did)
        return {
          did: f.did,
          handle: f.handle,
          displayName: (detailed?.displayName ?? f.displayName) || '',
          avatar: detailed?.avatar ?? f.avatar,
          description: detailed?.description ?? (f as any).description,
          followersCount: detailed?.followersCount ?? 0,
          followsCount: detailed?.followsCount ?? 0,
          postsCount: detailed?.postsCount ?? 0,
          createdAt: detailed?.createdAt,
          indexedAt: detailed?.indexedAt,
          followerIndex: i,
          interactionScore: bestieScores.get(f.did) ?? 0,
          sharedFollowsCount: sharedFollows.get(f.did) ?? 0,
        }
      })

      // Step 8: Compute aggregate statistics
      const stats = computeStats(enrichedFollowers, followingDids)

      setResult({ profile, followers: enrichedFollowers, mutualDids: followingDids, stats })
      setProgress({ phase: 'done', current: SCALE, total: SCALE, message: 'All done!' })
    } catch (err: any) {
      const message = err?.message ?? 'An unknown error occurred'
      setError(message)
      setProgress({ phase: 'error', current: 0, total: 0, message })
    }
  }, [])

  const reset = useCallback(() => {
    setProgress(INITIAL_PROGRESS)
    setResult(null)
    setError(null)
  }, [])

  return { progress, result, error, analyze, reset, abort }
}
