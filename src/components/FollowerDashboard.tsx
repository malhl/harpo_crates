/**
 * FollowerDashboard.tsx — Main analysis results dashboard.
 *
 * Renders overview stat cards and the follower list after the analysis
 * pipeline completes. Filters categories based on the selected analysis mode.
 */

import type { AnalysisMode, AnalysisResult } from '../types'
import { FOLLOWER_CATEGORIES } from '../types'
import { formatNumber } from '../utils/stats'
import { CategorySection } from './CategorySection'
import { FollowerList } from './FollowerList'

interface Props {
  result: AnalysisResult
  mode: AnalysisMode
}

/** Which category IDs to show for each mode */
const MODE_CATEGORIES: Record<AnalysisMode, string[] | 'all'> = {
  'all': 'all',
  'besties': ['besties'],
  'inner-circle': ['inner-circle'],
  'lurkers': ['lurkers'],
  'location': [],
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function FollowerDashboard({ result, mode }: Props) {
  const { stats, followers } = result

  const allowedCategories = MODE_CATEGORIES[mode]
  const categories = allowedCategories === 'all'
    ? FOLLOWER_CATEGORIES
    : FOLLOWER_CATEGORIES.filter(cat => allowedCategories.includes(cat.id))

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Section header */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-bold text-navy tracking-wide uppercase">Followers</h2>
        <p className="text-xs text-navy-faint">
          Completed in {formatDuration(result.elapsedSeconds)} · {result.apiCalls.toLocaleString()} API calls
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Active Followers" value={formatNumber(stats.totalFollowers)} />
        <StatCard label="Mutuals" value={formatNumber(stats.totalMutuals)} />
        <StatCard label="Avg Followers" value={formatNumber(stats.avgFollowersOfFollowers)} subtitle="per follower" />
        <StatCard label="Avg Posts" value={formatNumber(stats.avgPostsOfFollowers)} subtitle="per follower" />
      </div>

      {/* Follower List + Categories */}
      <div className="space-y-3">
        <FollowerList followers={followers} />

        {categories.map(cat => (
          <CategorySection key={cat.id} category={cat} followers={followers} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-lg border border-cream-dark p-4">
      <p className="text-xs text-navy-faint uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-navy mt-1">{value}</p>
      {subtitle && <p className="text-xs text-navy-faint">{subtitle}</p>}
    </div>
  )
}
