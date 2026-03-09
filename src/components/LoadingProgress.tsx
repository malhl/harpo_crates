/**
 * LoadingProgress.tsx — Progress bar with status message.
 *
 * Displays a horizontal progress bar with a percentage and a human-readable
 * status message during the analysis pipeline. Automatically hides itself
 * when the pipeline is idle or complete.
 *
 * The bar width is driven by the current/total ratio from AnalysisProgress,
 * with a smooth CSS transition for visual polish.
 */

import type { AnalysisProgress } from '../types'

interface Props {
  progress: AnalysisProgress
}

export function LoadingProgress({ progress }: Props) {
  // Don't render anything when idle (no analysis started) or done (results showing)
  if (progress.phase === 'idle' || progress.phase === 'done') return null

  const percentage = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  return (
    <div className="w-full max-w-xl mx-auto mt-6">
      {/* Status message and percentage */}
      <div className="flex justify-between text-sm text-gray-600 mb-2">
        <span>{progress.message}</span>
        {progress.total > 0 && <span>{percentage}%</span>}
      </div>
      {/* Progress bar track */}
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        {/* Progress bar fill — width is animated via transition-all */}
        <div
          className="bg-sky-500 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
