/**
 * FollowerLocations.tsx — Aggregate follower location breakdown.
 *
 * Scans all follower bios for location signals and displays a ranked
 * breakdown of where followers are posting from. Runs entirely client-side
 * with no additional API calls (uses bio data already fetched).
 */

import { useMemo, useState } from 'react'
import { scanFollowerLocations, type FollowerLocationResult } from '../utils/locationInference'
import type { EnrichedFollower } from '../types'

interface Props {
  followers: EnrichedFollower[]
}

const PAGE_SIZE = 20

export function FollowerLocations({ followers }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null)

  const result: FollowerLocationResult = useMemo(
    () => scanFollowerLocations(followers),
    [followers],
  )

  const detectedPct = result.total > 0 ? Math.round((result.detected / result.total) * 100) : 0
  const topCount = result.ranked[0]?.[1] ?? 0
  const maxBarWidth = topCount

  const visibleLocations = showAll ? result.ranked : result.ranked.slice(0, PAGE_SIZE)

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-bold text-navy tracking-wide uppercase">Follower Locations</h2>
        <p className="text-xs text-navy-faint">
          {result.detected} of {result.total} followers ({detectedPct}%) have a detectable location
        </p>
      </div>

      {result.ranked.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <p className="text-navy-faint">No location data found in follower bios.</p>
          <p className="text-xs text-navy-faint mt-2">
            This feature scans profile bios for location patterns like "Based in...", city names, etc.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {/* Top 8 summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-cream-dark border-b border-cream-dark">
            {result.ranked.slice(0, 8).map(([location, count], i) => (
              <div key={location} className={`px-3 py-3 text-center ${i >= 4 ? 'border-t border-cream-dark' : ''}`}>
                <p className="text-xs text-navy-faint uppercase tracking-wider">
                  #{i + 1}
                </p>
                <p className="text-sm font-bold text-navy mt-1 truncate" title={location}>
                  {location}
                </p>
                <p className="text-xs text-navy-faint">
                  {count} follower{count !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>

          {/* Full ranked list with bars */}
          <div className="divide-y divide-cream-dark/50">
            {visibleLocations.map(([location, count]) => {
              const pct = maxBarWidth > 0 ? (count / maxBarWidth) * 100 : 0
              const handles = result.locations.get(location) ?? []
              const isExpanded = expandedLocation === location

              return (
                <div key={location}>
                  <button
                    onClick={() => setExpandedLocation(isExpanded ? null : location)}
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-cream/30 transition-colors text-left cursor-pointer"
                  >
                    <span className="text-sm font-medium text-navy w-48 truncate shrink-0" title={location}>
                      {location}
                    </span>
                    <div className="flex-1 h-5 bg-cream rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue rounded-full transition-all"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-navy w-10 text-right shrink-0">
                      {count}
                    </span>
                    <span className="text-navy-faint text-xs w-4">
                      {isExpanded ? '\u25B2' : '\u25BC'}
                    </span>
                  </button>
                  {isExpanded && handles.length > 0 && (
                    <div className="px-4 pb-3 pl-8">
                      <div className="flex flex-wrap gap-1.5">
                        {handles.map(h => (
                          <a
                            key={h}
                            href={`https://bsky.app/profile/${h}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-cream text-navy-light px-2 py-1 rounded-full hover:bg-cream-dark transition-colors"
                          >
                            @{h}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Show more / less */}
          {result.ranked.length > PAGE_SIZE && (
            <div className="px-4 py-3 border-t border-cream-dark text-center">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-xs text-blue hover:text-blue-light transition-colors cursor-pointer"
              >
                {showAll
                  ? 'Show top 20 only'
                  : `Show all ${result.ranked.length} locations`}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 bg-cream text-xs text-navy-faint">
            Based on follower bio text (patterns like "Based in...", city names, etc.).
            {result.total - result.detected > 0 && (
              <> {result.total - result.detected} followers had no detectable location in their bio.</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
