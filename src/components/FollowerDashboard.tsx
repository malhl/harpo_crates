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
      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Active Followers" value={formatNumber(stats.totalFollowers)} />
        <StatCard label="Mutuals" value={formatNumber(stats.totalMutuals)} />
        <StatCard label="Avg Followers" value={formatNumber(stats.avgFollowersOfFollowers)} subtitle="per follower" />
        <StatCard label="Avg Posts" value={formatNumber(stats.avgPostsOfFollowers)} subtitle="per follower" />
      </div>

      {/* Categories */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Categories
        </h3>
        <div className="space-y-3">
          {FOLLOWER_CATEGORIES.map(cat => (
            <CategorySection key={cat.id} category={cat} followers={followers} />
          ))}
        </div>
      </div>

      {/* Follower List */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          All Followers
        </h3>
        <FollowerList followers={followers} />
      </div>
    </div>
  )
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  )
}
