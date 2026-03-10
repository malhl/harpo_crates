/**
 * LoadingProgress.tsx — Progress bar with status message and elapsed timer.
 *
 * Displays a horizontal progress bar with a percentage, a human-readable
 * status message, and an elapsed time counter during the analysis pipeline.
 * Automatically hides itself when the pipeline is idle or complete.
 *
 * The bar width is driven by the current/total ratio from AnalysisProgress,
 * with a smooth CSS transition for visual polish.
 */

import { useState, useEffect, useRef } from 'react'
import type { AnalysisProgress } from '../types'

interface Props {
  progress: AnalysisProgress
  onTimeout?: () => void
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatEstimate(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  return `${minutes}m`
}

/** Threshold at which we lock the estimate (percentage) */
const LOCK_THRESHOLD = 30
/** If elapsed exceeds this multiple of the locked estimate, abort */
const TIMEOUT_MULTIPLIER = 3

export function LoadingProgress({ progress, onTimeout }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lockedEstimateRef = useRef<number | null>(null)

  const isActive = progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error'

  useEffect(() => {
    if (isActive) {
      setElapsed(0)
      lockedEstimateRef.current = null
      intervalRef.current = setInterval(() => {
        setElapsed(prev => prev + 1)
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive])

  // Don't render anything when idle (no analysis started) or done (results showing)
  if (progress.phase === 'idle' || progress.phase === 'done') return null

  const percentage = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  // Lock the total estimate once we pass the threshold
  if (percentage >= LOCK_THRESHOLD && lockedEstimateRef.current === null && elapsed > 0) {
    lockedEstimateRef.current = Math.round(elapsed / (percentage / 100))
  }

  const lockedEstimate = lockedEstimateRef.current

  // Abort if elapsed exceeds 3x the locked estimate
  if (lockedEstimate && elapsed > lockedEstimate * TIMEOUT_MULTIPLIER && onTimeout) {
    onTimeout()
  }

  return (
    <div className="w-full max-w-xl mx-auto mt-6">
      {/* Status message and percentage */}
      <div className="flex justify-between text-sm text-navy-faint mb-2">
        <span>{progress.message}</span>
        {progress.total > 0 && <span>{percentage}%</span>}
      </div>
      {/* Progress bar track */}
      <div className="w-full bg-cream-dark rounded-full h-2.5">
        {/* Progress bar fill — width is animated via transition-all */}
        <div
          className="bg-gold h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {/* Elapsed time and locked total estimate below the bar */}
      <div className="text-xs text-navy-faint text-center mt-2">
        {formatElapsed(elapsed)}
        {lockedEstimate && percentage < 100 && (
          <span> / ~{formatEstimate(lockedEstimate)}</span>
        )}
      </div>
    </div>
  )
}
