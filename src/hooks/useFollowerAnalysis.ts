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

      // Estimate total work units across all phases so the bar never resets.
      // Work = 1 (profile) + followersCount + followsCount + followersCount (enriching)
      // These estimates are adjusted upward as actual counts come in from pagination,
      // since profile counts can underestimate the real paginated totals.
      let estFollowers = profile.followersCount ?? 0
      let estFollows = profile.followsCount ?? 0
      let totalWork = 1 + estFollowers + estFollows + estFollowers
      let completed = 1 // profile fetch done

      // Step 2: Paginate through all followers
      setProgress({ phase: 'followers', current: completed, total: totalWork, message: 'Fetching followers...' })
      const followers = await getAllFollowers(handle, (loaded) => {
        // If the actual count exceeds the estimate, revise upward
        if (loaded > estFollowers) {
          totalWork += (loaded - estFollowers) * 2 // followers + enriching
          estFollowers = loaded
        }
        setProgress({ phase: 'followers', current: completed + loaded, total: totalWork, message: `Fetching followers (${loaded}/${estFollowers})...` })
      })
      // Final correction after all followers are fetched
      if (followers.length !== estFollowers) {
        totalWork += (followers.length - estFollowers) * 2
        estFollowers = followers.length
      }
      completed += followers.length

      // Step 3: Fetch following list for mutual detection
      setProgress({ phase: 'following', current: completed, total: totalWork, message: 'Fetching following list...' })
      const following = await getAllFollowing(handle, (loaded) => {
        if (loaded > estFollows) {
          totalWork += loaded - estFollows
          estFollows = loaded
        }
        setProgress({ phase: 'following', current: completed + loaded, total: totalWork, message: `Fetching following (${loaded}/${estFollows})...` })
      })
      if (following.length !== estFollows) {
        totalWork += following.length - estFollows
        estFollows = following.length
      }
      completed += following.length
      const followingDids = new Set(following.map(f => f.did))

      // Step 4: Enrich follower profiles with full stats
      const followerDids = followers.map(f => f.did)
      setProgress({ phase: 'enriching', current: completed, total: totalWork, message: 'Enriching profiles...' })
      const enriched = await enrichProfiles(followerDids, (loaded) => {
        setProgress({ phase: 'enriching', current: completed + loaded, total: totalWork, message: `Enriching profiles (${loaded}/${followerDids.length})...` })
      })

      // Step 5: Map to EnrichedFollower objects
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
