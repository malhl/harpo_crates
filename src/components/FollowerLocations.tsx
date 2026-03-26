/**
 * FollowerLocations.tsx — Aggregate follower location breakdown.
 *
 * Scans all follower bios for location signals and displays a ranked
 * breakdown of where followers are posting from, using the same tile
 * layout as other dashboard categories. Paged by follower-count bands
 * (e.g. "50+", "20–49", "10–19", etc.) computed to yield ~10 pages.
 */

import { useMemo, useState } from 'react'
import { scanFollowerLocations, type FollowerLocationResult } from '../utils/locationInference'
import type { EnrichedFollower } from '../types'

interface Props {
  followers: EnrichedFollower[]
}

interface Band {
  label: string
  min: number
  max: number
}

const TILE_PAGE_SIZE = 52

/** Compute ~10 count bands from the data */
function computeBands(ranked: [string, number][]): Band[] {
  if (ranked.length === 0) return []
  const max = ranked[0][1]
  const min = ranked[ranked.length - 1][1]
  if (max === min) return [{ label: `${max}`, min: max, max }]

  // Try "nice" thresholds that produce readable labels
  const nice = [500, 200, 100, 50, 20, 10, 5, 3, 2, 1]
  const thresholds = nice.filter(n => n <= max)

  // Build bands from thresholds
  const bands: Band[] = []
  for (let i = 0; i < thresholds.length; i++) {
    const lo = thresholds[i]
    const hi = i === 0 ? Infinity : thresholds[i - 1] - 1
    const count = ranked.filter(([, c]) => c >= lo && c <= hi).length
    if (count > 0) {
      const label = hi === Infinity ? `${lo}+` : lo === hi ? `${lo}` : `${lo}–${hi}`
      bands.push({ label, min: lo, max: hi })
    }
  }

  // If we got too many bands (>12), merge the smallest ones
  while (bands.length > 12) {
    const last = bands.pop()!
    const prev = bands[bands.length - 1]
    prev.label = `${last.min}–${prev.max === Infinity ? prev.min + '+' : prev.max}`
    prev.min = last.min
  }

  return bands
}

export function FollowerLocations({ followers }: Props) {
  const [activeBand, setActiveBand] = useState(0)
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null)
  const [tileCounts, setTileCounts] = useState<Record<string, number>>({})

  const result: FollowerLocationResult = useMemo(
    () => scanFollowerLocations(followers),
    [followers],
  )

  const followersByHandle = useMemo(() => {
    const map = new Map<string, EnrichedFollower>()
    for (const f of followers) map.set(f.handle, f)
    return map
  }, [followers])

  const bands = useMemo(() => computeBands(result.ranked), [result.ranked])

  const detectedPct = result.total > 0 ? Math.round((result.detected / result.total) * 100) : 0
  const maxCount = result.ranked[0]?.[1] ?? 1

  const currentBand = bands[activeBand]
  const bandLocations = currentBand
    ? result.ranked.filter(([, count]) => count >= currentBand.min && count <= currentBand.max)
    : []

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
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
        <div className="space-y-3">
          {/* Band selector */}
          {bands.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {bands.map((band, i) => {
                const count = result.ranked.filter(([, c]) => c >= band.min && c <= band.max).length
                return (
                  <button
                    key={band.label}
                    onClick={() => { setActiveBand(i); setExpandedLocation(null) }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      activeBand === i
                        ? 'bg-blue text-white'
                        : 'bg-white border border-cream-dark text-navy-faint hover:border-navy-faint'
                    }`}
                  >
                    {band.label} <span className="opacity-70">({count})</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Location rows for active band */}
          <div className="space-y-2">
            {bandLocations.map(([location, count]) => {
              const handles = result.locations.get(location) ?? []
              const isExpanded = expandedLocation === location
              const visibleTiles = tileCounts[location] ?? TILE_PAGE_SIZE
              const sortedHandles = [...handles].sort((a, b) => a.localeCompare(b))
              const visibleHandles = sortedHandles.slice(0, visibleTiles)

              return (
                <div key={location}>
                  <button
                    onClick={() => setExpandedLocation(isExpanded ? null : location)}
                    className="w-full relative overflow-hidden flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-cream-dark hover:border-navy-faint transition-colors text-left cursor-pointer"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-blue-faint transition-all"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                    <div className="relative">
                      <span className="font-medium text-navy">{location}</span>
                      <span className="ml-2 text-sm text-navy-faint">({count})</span>
                    </div>
                    <span className="relative text-navy-faint">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 max-h-[500px] overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {visibleHandles.map(handle => {
                          const follower = followersByHandle.get(handle)
                          if (!follower) return null
                          return (
                            <a
                              key={follower.did}
                              href={`https://bsky.app/profile/${follower.handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex flex-col items-center text-center p-4 bg-white rounded-lg border border-cream-dark hover:border-navy-faint hover:shadow-sm transition-all no-underline"
                            >
                              {follower.avatar ? (
                                <img src={follower.avatar} alt="" className="w-[84px] h-[84px] rounded-full" />
                              ) : (
                                <div className="w-[84px] h-[84px] rounded-full bg-cream-dark" />
                              )}
                              <span className="font-medium text-navy text-sm mt-2 truncate w-full">
                                {follower.displayName || follower.handle}
                              </span>
                              <span className="text-xs text-navy-faint truncate w-full">@{follower.handle}</span>
                            </a>
                          )
                        })}
                      </div>
                      {handles.length > visibleTiles && (
                        <button
                          onClick={() => setTileCounts(c => ({ ...c, [location]: (c[location] ?? TILE_PAGE_SIZE) + TILE_PAGE_SIZE }))}
                          className="w-full mt-3 py-2 text-sm text-blue hover:text-blue-light font-medium hover:bg-blue-faint rounded-lg transition-colors cursor-pointer"
                        >
                          Show more ({visibleTiles} of {handles.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
