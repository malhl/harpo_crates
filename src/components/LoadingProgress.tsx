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
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function LoadingProgress({ progress }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isActive = progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error'

  useEffect(() => {
    if (isActive) {
      setElapsed(0)
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

  return (
    <div className="w-full max-w-xl mx-auto mt-6">
      {/* Status message and percentage */}
      <div className="flex justify-between text-sm text-navy-faint mb-2">
        <span>{progress.message}</span>
        <span className="flex gap-3">
          {progress.total > 0 && <span>{percentage}%</span>}
          <span>{formatElapsed(elapsed)}</span>
        </span>
      </div>
      {/* Progress bar track */}
      <div className="w-full bg-cream-dark rounded-full h-2.5">
        {/* Progress bar fill — width is animated via transition-all */}
        <div
          className="bg-gold h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
