/**
 * hooks/useFollowerAnalysis.ts — Core analysis pipeline orchestrator.
 *
 * Manages the multi-step async pipeline, skipping steps based on AnalysisMode:
 *   - all:          profile → followers → following → enrich → interactions → connections → stats
 *   - besties:      profile → followers → following → enrich → interactions → stats
 *   - inner-circle: profile → followers → following → enrich → connections → stats
 *   - lurkers:      profile → followers → following → enrich → stats
 *   - location:     profile only (LocationGuess component handles the rest)
 *
 * Progress uses a weighted virtual scale (0–1000) adapted to the active steps.
 */

import { useState, useCallback, useRef } from 'react'
import { getProfile, getAllFollowers, getAllFollowing, enrichProfiles, computeBestieScores, computeSharedFollows, type IsAborted } from '../api/bluesky'
import { computeStats } from '../utils/stats'
import { debugLog } from '../utils/debug'
import type { AnalysisMode, AnalysisProgress, AnalysisResult, EnrichedFollower } from '../types'

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
  const [mode, setMode] = useState<AnalysisMode>('all')
  const abortRef = useRef(false)

  const abort = useCallback(() => {
    abortRef.current = true
  }, [])

  const analyze = useCallback(async (handle: string, analysisMode: AnalysisMode = 'all') => {
    setResult(null)
    setError(null)
    setMode(analysisMode)
    abortRef.current = false

    const isAborted: IsAborted = () => abortRef.current
    const startTime = Date.now()

    let currentPhase: AnalysisProgress['phase'] = 'profile'

    // Location mode: fetch profile + followers (slim profiles include bios for location parsing)
    if (analysisMode === 'location') {
      try {
        setProgress({ phase: 'profile', current: 0, total: 100, message: 'Looking them up...' })
        const profile = await getProfile(handle)
        let totalApiCalls = 1

        const estFollowers = profile.followersCount ?? 0
        setProgress({ phase: 'followers', current: 10, total: 100, message: 'Rounding up followers...' })
        const followers = await getAllFollowers(handle, (loaded) => {
          const pct = Math.min(90, 10 + Math.round((loaded / Math.max(estFollowers, 1)) * 80))
          setProgress({ phase: 'followers', current: pct, total: 100, message: `Rounding up followers (${loaded}/${estFollowers})...` })
        })
        totalApiCalls += Math.ceil(followers.length / 100) || 1

        // Map slim followers to EnrichedFollower shape (stats will be zero since we skip enrichment)
        const enrichedFollowers: EnrichedFollower[] = followers.map((f, i) => ({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName || '',
          avatar: f.avatar,
          description: f.description,
          followersCount: 0,
          followsCount: 0,
          postsCount: 0,
          followerIndex: i,
          interactionScore: 0,
          sharedFollowsCount: 0,
        }))

        const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
        setResult({
          profile,
          followers: enrichedFollowers,
          mutualDids: new Set(),
          stats: { totalFollowers: followers.length, totalMutuals: 0, avgFollowersOfFollowers: 0, avgPostsOfFollowers: 0 },
          elapsedSeconds,
          apiCalls: totalApiCalls,
        })
        setProgress({ phase: 'done', current: 100, total: 100, message: 'All done!' })
      } catch (err: any) {
        const message = err?.message ?? 'An unknown error occurred'
        setError(message)
        setProgress({ phase: 'error', current: 0, total: 0, message })
      }
      return
    }

    const needInteractions = analysisMode === 'all' || analysisMode === 'besties'
    const needConnections = analysisMode === 'all' || analysisMode === 'inner-circle'

    try {
      const SCALE = 1000

      // Adjust phase weights based on which heavy steps run
      const PHASES = needInteractions && needConnections
        ? { early: { start: 0, end: 300 }, enriching: { start: 300, end: 400 }, interactions: { start: 400, end: 700 }, connections: { start: 700, end: 1000 } }
        : needInteractions
        ? { early: { start: 0, end: 250 }, enriching: { start: 250, end: 350 }, interactions: { start: 350, end: 1000 }, connections: { start: 1000, end: 1000 } }
        : needConnections
        ? { early: { start: 0, end: 250 }, enriching: { start: 250, end: 350 }, interactions: { start: 1000, end: 1000 }, connections: { start: 350, end: 1000 } }
        : { early: { start: 0, end: 500 }, enriching: { start: 500, end: 1000 }, interactions: { start: 1000, end: 1000 }, connections: { start: 1000, end: 1000 } }

      const phaseProgress = (phase: keyof typeof PHASES, done: number, total: number) => {
        const { start, end } = PHASES[phase]
        if (total <= 0 || start >= end) return start
        return Math.min(end, start + Math.round((done / total) * (end - start)))
      }

      let estimatedSeconds: number | undefined

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
      const emitForce = (phase: AnalysisProgress['phase'], current: number, total: number, message: string) => {
        currentPhase = phase
        lastEmitTime = Date.now()
        setProgress({ phase, current, total, message, estimatedSeconds })
      }

      let totalApiCalls = 0

      // Step 1: Profile
      emitForce('profile', 0, SCALE, 'Looking them up...')
      const profile = await getProfile(handle)
      totalApiCalls++
      debugLog('profile', { mode: analysisMode, followers: profile.followersCount, following: profile.followsCount, posts: profile.postsCount })

      let estFollowers = profile.followersCount ?? 0
      let estFollows = profile.followsCount ?? 0
      let estFollowerPages = Math.ceil(estFollowers / 100) || 1
      const estFollowingPages = Math.ceil(estFollows / 100) || 1
      const earlyTotal = 1 + estFollowerPages + estFollowingPages
      let earlyDone = 1

      // Step 2: Followers
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

      // Step 3: Following
      emitForce('following', phaseProgress('early', earlyDone, earlyTotal), SCALE, 'Checking who they follow...')
      const following = await getAllFollowing(handle, (loaded) => {
        earlyDone = 1 + actualFollowerPages + Math.ceil(loaded / 100)
        emit('following', phaseProgress('early', earlyDone, earlyTotal), SCALE, `Checking who they follow (${loaded}/${estFollows})...`)
      })
      const followingDids = new Set(following)
      totalApiCalls += Math.ceil(following.length / 100) || 1

      // Estimate
      const earlyElapsedMs = Date.now() - startTime
      const earlyCallCount = 1 + actualFollowerPages + (Math.ceil(following.length / 100) || 1)
      const msPerCall = earlyElapsedMs / earlyCallCount
      const estMutualCount = Math.min(followers.length, following.length)
      const estRemainingCalls = (Math.ceil(followers.length / 25) || 1)
        + (needInteractions ? 200 : 0)
        + (needConnections ? estMutualCount * 5 / 3 : 0)
      estimatedSeconds = Math.ceil((earlyElapsedMs + estRemainingCalls * msPerCall) / 1000)
      debugLog('initial estimate', { mode: analysisMode, earlyElapsedMs, msPerCall: Math.round(msPerCall), estimatedSeconds })

      // Step 4: Enrich
      const followerDids = followers.map(f => f.did)
      const actualEnrichBatches = Math.ceil(followers.length / 25) || 1
      emitForce('enriching', phaseProgress('enriching', 0, actualEnrichBatches), SCALE, 'Getting the details...')
      const enriched = await enrichProfiles(followerDids, (loaded) => {
        const enrichDone = Math.ceil(loaded / 25)
        emit('enriching', phaseProgress('enriching', enrichDone, actualEnrichBatches), SCALE, `Getting the details (${loaded}/${followerDids.length})...`)
      }, isAborted)
      totalApiCalls += actualEnrichBatches

      // Step 5: Interactions (besties / all)
      let bestieScores = new Map<string, number>()
      let interactedDids = new Set<string>()

      if (needInteractions) {
        const estPosts = Math.min(profile.postsCount ?? 0, 1825)
        const estInteractionCalls = Math.ceil(estPosts / 100) + estPosts * 2 + Math.min(100, estFollowers) * 100 + 20
        let interactionCallsReported = 0
        emitForce('interactions', phaseProgress('interactions', 0, estInteractionCalls), SCALE, 'Finding the besties...')
        let lastInteractionLog = 0
        const bestieResult = await computeBestieScores(profile.did, (apiCalls, message) => {
          interactionCallsReported = apiCalls
          const interactionTotal = Math.max(estInteractionCalls, apiCalls + 10)
          if (apiCalls - lastInteractionLog >= 500) {
            debugLog('interactions', { apiCalls, message })
            lastInteractionLog = apiCalls
          }
          emit('interactions', phaseProgress('interactions', apiCalls, interactionTotal), SCALE, message)
        }, isAborted)
        bestieScores = bestieResult.scores
        interactedDids = bestieResult.interactedDids
        totalApiCalls += interactionCallsReported
      }

      // Update estimate before connections
      const mutualFollowerDids = followerDids.filter(d => followingDids.has(d))
      if (needConnections) {
        const elapsedSoFar = Date.now() - startTime
        estimatedSeconds = Math.ceil(elapsedSoFar / 1000 * (mutualFollowerDids.length > 50 ? 4 : 2))
      }

      // Step 6: Connections (inner-circle / all)
      let sharedFollows = new Map<string, number>()

      if (needConnections) {
        const connectionStart = Date.now()
        emitForce('connections', phaseProgress('connections', 0, mutualFollowerDids.length), SCALE, 'Mapping the inner circle...')
        let connectionFollowersDone = 0
        let connectionPages = 0
        sharedFollows = await computeSharedFollows(mutualFollowerDids, followingDids, (pages, message) => {
          connectionPages = pages
          const match = message.match(/\((\d+)\//)
          if (match) connectionFollowersDone = parseInt(match[1])
          if (connectionFollowersDone > 3) {
            const connectionElapsed = Date.now() - connectionStart
            const rate = connectionElapsed / connectionFollowersDone
            const remaining = (mutualFollowerDids.length - connectionFollowersDone) * rate
            estimatedSeconds = Math.ceil((Date.now() - startTime + remaining) / 1000)
          }
          emit('connections', phaseProgress('connections', connectionFollowersDone, mutualFollowerDids.length), SCALE, message)
        }, isAborted)
        totalApiCalls += connectionPages
      }

      // Step 7: Assemble results
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

      const stats = computeStats(enrichedFollowers, followingDids)
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
      setResult({ profile, followers: enrichedFollowers, mutualDids: followingDids, stats, elapsedSeconds, apiCalls: totalApiCalls })
      debugLog('done', { mode: analysisMode, totalElapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's' })
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

  return { progress, result, error, mode, analyze, reset, abort }
}
