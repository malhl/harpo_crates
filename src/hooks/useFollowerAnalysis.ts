/**
 * hooks/useFollowerAnalysis.ts — Core analysis pipeline orchestrator.
 *
 * Manages the multi-step async pipeline:
 *   1. Profile lookup
 *   2. Follower fetch (paginated)
 *   3. Following fetch (for mutual detection)
 *   4. Profile enrichment (batch)
 *   5. Stats computation
 */

import { useState, useCallback } from 'react'
import { getProfile, getAllFollowers, getAllFollowing, enrichProfiles } from '../api/bluesky'
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

  const analyze = useCallback(async (handle: string) => {
    setResult(null)
    setError(null)

    try {
      // Step 1: Fetch the target user's profile
      setProgress({ phase: 'profile', current: 0, total: 1, message: 'Loading profile...' })
      const profile = await getProfile(handle)

      // Step 2: Paginate through all followers
      setProgress({ phase: 'followers', current: 0, total: profile.followersCount ?? 0, message: 'Fetching followers...' })
      const followers = await getAllFollowers(handle, (loaded, total) => {
        setProgress({ phase: 'followers', current: loaded, total, message: `Fetching followers (${loaded}/${total})...` })
      })

      // Step 3: Fetch following list for mutual detection
      setProgress({ phase: 'following', current: 0, total: profile.followsCount ?? 0, message: 'Fetching following list...' })
      const following = await getAllFollowing(handle, (loaded, total) => {
        setProgress({ phase: 'following', current: loaded, total, message: `Fetching following (${loaded}/${total})...` })
      })
      const followingDids = new Set(following.map(f => f.did))

      // Step 4: Enrich follower profiles with full stats
      const followerDids = followers.map(f => f.did)
      setProgress({ phase: 'enriching', current: 0, total: followerDids.length, message: 'Enriching profiles...' })
      const enriched = await enrichProfiles(followerDids, (loaded, total) => {
        setProgress({ phase: 'enriching', current: loaded, total, message: `Enriching profiles (${loaded}/${total})...` })
      })

      // Step 5: Map to EnrichedFollower objects
      const enrichedFollowers: EnrichedFollower[] = followers.map(f => {
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
        }
      })

      // Step 6: Compute aggregate statistics
      const stats = computeStats(enrichedFollowers, followingDids)

      setResult({ profile, followers: enrichedFollowers, mutualDids: followingDids, stats })
      setProgress({ phase: 'done', current: 1, total: 1, message: 'Analysis complete!' })
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

  return { progress, result, error, analyze, reset }
}
