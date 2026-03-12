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
import { debugLog } from '../utils/debug'
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

    let currentPhase: AnalysisProgress['phase'] = 'profile'

    try {
      // Weighted progress using per-phase sub-ranges within a 1000-unit scale.
      // Each phase owns a fixed slice so it can never overflow into the next.
      const SCALE = 1000
      const PHASES = {
        early:        { start: 0,   end: 300 },  // 30%
        enriching:    { start: 300, end: 400 },   // 10%
        interactions: { start: 400, end: 700 },   // 30%
        connections:  { start: 700, end: 1000 },  // 30%
      }
      const phaseProgress = (phase: keyof typeof PHASES, done: number, total: number) => {
        const { start, end } = PHASES[phase]
        if (total <= 0) return start
        return Math.min(end, start + Math.round((done / total) * (end - start)))
      }

      // Dynamic estimate: updated after each phase based on observed rates
      let estimatedSeconds: number | undefined

      // Throttled emit: limit React state updates to once per 500ms
      let lastEmitTime = 0
      const EMIT_INTERVAL_MS = 500
      const emit = (phase: AnalysisProgress['phase'], current: number, total: number, message: string) => {
        currentPhase = phase
        const now = Date.now()
        if (now - lastEmitTime >= EMIT_INTERVAL_MS || phase !== currentPhase) {
          lastEmitTime = now
          setProgress({ phase, current, total, message, estimatedSeconds })
        }
      }
      // Force-emit for phase transitions (unthrottled)
      const emitForce = (phase: AnalysisProgress['phase'], current: number, total: number, message: string) => {
        currentPhase = phase
        lastEmitTime = Date.now()
        setProgress({ phase, current, total, message, estimatedSeconds })
      }

      // Track total API calls across all phases
      let totalApiCalls = 0

      // Step 1: Fetch the target user's profile
      emitForce('profile', 0, SCALE, 'Looking them up...')
      const profile = await getProfile(handle)
      totalApiCalls++
      debugLog('profile', { followers: profile.followersCount, following: profile.followsCount, posts: profile.postsCount })

      // Estimate counts for progress tracking
      let estFollowers = profile.followersCount ?? 0
      let estFollows = profile.followsCount ?? 0

      let estFollowerPages = Math.ceil(estFollowers / 100) || 1
      const estFollowingPages = Math.ceil(estFollows / 100) || 1

      // Early phase: profile(1) + followerPages + followingPages
      const earlyTotal = 1 + estFollowerPages + estFollowingPages
      let earlyDone = 1 // profile done

      debugLog('estimates', { earlyTotal, estFollowerPages, estFollowingPages })

      // Step 2: Paginate through all followers
      emitForce('followers', phaseProgress('early', earlyDone, earlyTotal), SCALE, 'Rounding up followers...')
      const followers = await getAllFollowers(handle, (loaded) => {
        if (loaded > estFollowers) {
          estFollowerPages = Math.ceil(loaded / 100)
          estFollowers = loaded
        }
        earlyDone = 1 + Math.ceil(loaded / 100)
        emit('followers', phaseProgress('early', earlyDone, earlyTotal), SCALE, `Rounding up followers (${loaded}/${estFollowers})...`)
      })
      const actualFollowerPages = Math.ceil(followers.length / 100) || 1
      earlyDone = 1 + actualFollowerPages
      totalApiCalls += actualFollowerPages
      debugLog('followers done', { count: followers.length, pages: actualFollowerPages })

      // Step 3: Fetch following list for mutual detection
      emitForce('following', phaseProgress('early', earlyDone, earlyTotal), SCALE, 'Checking who they follow...')
      const following = await getAllFollowing(handle, (loaded) => {
        earlyDone = 1 + actualFollowerPages + Math.ceil(loaded / 100)
        emit('following', phaseProgress('early', earlyDone, earlyTotal), SCALE, `Checking who they follow (${loaded}/${estFollows})...`)
      })
      const followingDids = new Set(following)
      totalApiCalls += Math.ceil(following.length / 100) || 1
      debugLog('following done', { count: following.length })

      // Set initial estimate based on early phase rate
      const earlyElapsedMs = Date.now() - startTime
      const earlyCallCount = 1 + actualFollowerPages + (Math.ceil(following.length / 100) || 1)
      const msPerCall = earlyElapsedMs / earlyCallCount
      const estMutualCount = Math.min(followers.length, following.length)
      // Rough total: enrich batches + ~200 interaction calls + mutual connections (concurrent /3)
      const estRemainingCalls = (Math.ceil(followers.length / 25) || 1) + 200 + estMutualCount * 5 / 3
      estimatedSeconds = Math.ceil((earlyElapsedMs + estRemainingCalls * msPerCall) / 1000)
      debugLog('initial estimate', { earlyElapsedMs, msPerCall: Math.round(msPerCall), estimatedSeconds })

      // Step 4: Enrich follower profiles with full stats
      const followerDids = followers.map(f => f.did)
      const actualEnrichBatches = Math.ceil(followers.length / 25) || 1
      let enrichDone = 0
      emitForce('enriching', phaseProgress('enriching', 0, actualEnrichBatches), SCALE, 'Getting the details...')
      const enriched = await enrichProfiles(followerDids, (loaded) => {
        enrichDone = Math.ceil(loaded / 25)
        emit('enriching', phaseProgress('enriching', enrichDone, actualEnrichBatches), SCALE, `Getting the details (${loaded}/${followerDids.length})...`)
      }, isAborted)
      totalApiCalls += actualEnrichBatches
      debugLog('enriching done', { batches: actualEnrichBatches, pct: Math.round(phaseProgress('enriching', actualEnrichBatches, actualEnrichBatches) / SCALE * 100) })

      // Step 5: Compute bestie interaction scores
      // Estimate total calls: feed pages + post*2 (thread+reposts) + friend feeds + threads
      const estPosts = Math.min(profile.postsCount ?? 0, 1825)
      const estInteractionCalls = Math.ceil(estPosts / 100) + estPosts * 2 + Math.min(100, estFollowers) * 100 + 20
      let interactionCallsReported = 0
      emitForce('interactions', phaseProgress('interactions', 0, estInteractionCalls), SCALE, 'Finding the besties...')
      let lastInteractionLog = 0
      const bestieResult = await computeBestieScores(profile.did, (apiCalls, message) => {
        interactionCallsReported = apiCalls
        // Use actual calls vs estimate, but cap at 95% so it doesn't hit 100% early
        const interactionTotal = Math.max(estInteractionCalls, apiCalls + 10)
        if (apiCalls - lastInteractionLog >= 500) {
          debugLog('interactions', { apiCalls, message, pct: Math.round(phaseProgress('interactions', apiCalls, interactionTotal) / SCALE * 100) })
          lastInteractionLog = apiCalls
        }
        emit('interactions', phaseProgress('interactions', apiCalls, interactionTotal), SCALE, message)
      }, isAborted)
      const { scores: bestieScores, interactedDids } = bestieResult
      totalApiCalls += interactionCallsReported
      debugLog('interactions done', { interactionCallsReported, estInteractionCalls })

      // Update estimate dynamically now that we know interaction rate
      const elapsedSoFar = Date.now() - startTime
      const mutualFollowerDids = followerDids.filter(d => followingDids.has(d))
      // Rough estimate: connections take ~70% of total time for large accounts
      estimatedSeconds = Math.ceil(elapsedSoFar / 1000 * (mutualFollowerDids.length > 50 ? 4 : 2))
      debugLog('estimate updated', { elapsedSoFar, estimatedSeconds, mutuals: mutualFollowerDids.length })

      // Step 6: Compute shared follows (only for mutuals — followers the target also follows back)
      const connectionStart = Date.now()
      emitForce('connections', phaseProgress('connections', 0, mutualFollowerDids.length), SCALE, 'Mapping the inner circle...')
      let lastConnectionLog = 0
      let connectionFollowersDone = 0
      let connectionPages = 0
      const sharedFollows = await computeSharedFollows(mutualFollowerDids, followingDids, (pages, message) => {
        connectionPages = pages
        // Extract followersDone from the message (e.g., "(42/178)")
        const match = message.match(/\((\d+)\//)
        if (match) connectionFollowersDone = parseInt(match[1])
        // Dynamically update estimate based on connection rate
        if (connectionFollowersDone > 3) {
          const connectionElapsed = Date.now() - connectionStart
          const rate = connectionElapsed / connectionFollowersDone
          const remaining = (mutualFollowerDids.length - connectionFollowersDone) * rate
          estimatedSeconds = Math.ceil((Date.now() - startTime + remaining) / 1000)
        }
        if (pages - lastConnectionLog >= 500) {
          debugLog('connections', { pages, message, pct: Math.round(phaseProgress('connections', connectionFollowersDone, mutualFollowerDids.length) / SCALE * 100) })
          lastConnectionLog = pages
        }
        emit('connections', phaseProgress('connections', connectionFollowersDone, mutualFollowerDids.length), SCALE, message)
      }, isAborted)

      totalApiCalls += connectionPages
      debugLog('connections done', { followersDone: connectionFollowersDone, mutuals: mutualFollowerDids.length, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's' })

      // Step 7: Map to EnrichedFollower objects
      const enrichedFollowers: EnrichedFollower[] = followers.map((f, i) => {
        const detailed = enriched.get(f.did)
        return {
          did: f.did,
          handle: f.handle,
          displayName: (detailed?.displayName ?? f.displayName) || '',
          avatar: detailed?.avatar ?? f.avatar,
          description: detailed?.description ?? f.description,
          followersCount: detailed?.followersCount ?? 0,
          followsCount: detailed?.followsCount ?? 0,
          postsCount: detailed?.postsCount ?? 0,
          createdAt: detailed?.createdAt,
          indexedAt: detailed?.indexedAt,
          followerIndex: i,
          interactionScore: bestieScores.get(f.did) ?? (interactedDids.has(f.did) ? 0.1 : 0),
          sharedFollowsCount: sharedFollows.get(f.did) ?? 0,
        }
      })

      // Step 8: Compute aggregate statistics
      const stats = computeStats(enrichedFollowers, followingDids)

      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
      setResult({ profile, followers: enrichedFollowers, mutualDids: followingDids, stats, elapsedSeconds, apiCalls: totalApiCalls })
      debugLog('done', { totalElapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's', estimatedSeconds })
      setProgress({ phase: 'done', current: SCALE, total: SCALE, message: 'All done!' })
    } catch (err: any) {
      const message = err?.message ?? 'An unknown error occurred'
      debugLog('error', { phase: currentPhase, message, stack: err?.stack, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's' })
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
