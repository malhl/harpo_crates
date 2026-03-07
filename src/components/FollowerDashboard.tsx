/**
 * FollowerDashboard.tsx — Main analysis results dashboard.
 *
 * Renders overview stat cards and the follower list after the analysis
 * pipeline completes.
 */

import type { AnalysisResult } from '../types'
import { formatNumber } from '../utils/stats'
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
        <StatCard label="Total Followers" value={formatNumber(stats.totalFollowers)} />
        <StatCard label="Mutuals" value={formatNumber(stats.totalMutuals)} />
        <StatCard label="Avg Followers" value={formatNumber(stats.avgFollowersOfFollowers)} subtitle="per follower" />
        <StatCard label="Avg Posts" value={formatNumber(stats.avgPostsOfFollowers)} subtitle="per follower" />
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
