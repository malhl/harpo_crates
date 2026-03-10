/**
 * FollowerDashboard.tsx — Main analysis results dashboard.
 *
 * Renders overview stat cards and the follower list after the analysis
 * pipeline completes.
 */

import type { AnalysisResult } from '../types'
import { FOLLOWER_CATEGORIES } from '../types'
import { formatNumber } from '../utils/stats'
import { CategorySection } from './CategorySection'
import { FollowerList } from './FollowerList'

interface Props {
  result: AnalysisResult
}

export function FollowerDashboard({ result }: Props) {
  const { stats, followers } = result

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Section header */}
      <h2 className="text-2xl font-bold text-navy tracking-wide uppercase">Followers</h2>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Active Followers" value={formatNumber(stats.totalFollowers)} />
        <StatCard label="Mutuals" value={formatNumber(stats.totalMutuals)} />
        <StatCard label="Avg Followers" value={formatNumber(stats.avgFollowersOfFollowers)} subtitle="per follower" />
        <StatCard label="Avg Posts" value={formatNumber(stats.avgPostsOfFollowers)} subtitle="per follower" />
      </div>

      {/* Follower List */}
      <div className="space-y-3">
        <FollowerList followers={followers} />

        {/* Categories */}
        {FOLLOWER_CATEGORIES.map(cat => (
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
