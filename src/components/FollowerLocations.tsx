/**
 * FollowerLocations.tsx — Aggregate follower location breakdown.
 *
 * Scans all follower bios for location signals and displays a ranked
 * breakdown of where followers are posting from, using the same tile
 * layout as other dashboard categories. Paged by follower-count bands.
 *
 * Tiles are color-coded by relationship (follower / following / mutual).
 * A radio menu lets users group by most specific location, region, or country.
 */

import { useMemo, useState } from 'react'
import { scanFollowerLocations, type FollowerLocationResult } from '../utils/locationInference'
import type { EnrichedFollower } from '../types'

interface Props {
  followers: EnrichedFollower[]
  followerDids?: Set<string>
  followingDids?: Set<string>
  nearbyProfiles?: EnrichedFollower[]
  detectedCity?: string
}

interface Band {
  label: string
  min: number
  max: number
}

type Relationship = 'follower' | 'following' | 'mutual'
type Grouping = 'specific' | 'region' | 'country'

const TILE_PAGE_SIZE = 52

const GROUPING_OPTIONS: { value: Grouping; label: string }[] = [
  { value: 'specific', label: 'Most Specific' },
  { value: 'region', label: 'Region' },
  { value: 'country', label: 'Country' },
]

/** Roll up a location string to the requested grouping level.
 *  "Seattle, WA, US" → region: "WA, US", country: "US"
 *  "London, UK"       → region: "UK",    country: "UK"
 *  "California, US"   → region: "California, US", country: "US"
 */
function groupLocation(location: string, grouping: Grouping): string {
  if (grouping === 'specific') return location
  const parts = location.split(',').map(s => s.trim())
  if (grouping === 'country') return parts[parts.length - 1]
  // region: drop the first part (city) if there are 3+ parts, otherwise keep as-is
  if (parts.length >= 3) return parts.slice(1).join(', ')
  return parts.length >= 2 ? parts.slice(-2).join(', ') : location
}

/** Re-aggregate scan results at a different grouping level */
function regroupResult(result: FollowerLocationResult, grouping: Grouping): FollowerLocationResult {
  if (grouping === 'specific') return result

  const grouped = new Map<string, string[]>()
  let detected = 0

  for (const [location, handles] of result.locations) {
    const key = groupLocation(location, grouping)
    const list = grouped.get(key) ?? []
    list.push(...handles)
    grouped.set(key, list)
  }

  for (const handles of grouped.values()) detected += handles.length

  const ranked = [...grouped.entries()]
    .map(([loc, handles]) => [loc, handles.length] as [string, number])
    .sort((a, b) => b[1] - a[1])

  return { locations: grouped, ranked, detected, total: result.total }
}

/** Compute ~10 count bands from the data */
function computeBands(ranked: [string, number][]): Band[] {
  if (ranked.length === 0) return []
  const max = ranked[0][1]
  const min = ranked[ranked.length - 1][1]
  if (max === min) return [{ label: `${max}`, min: max, max }]

  const nice = [500, 200, 100, 50, 20, 10, 5, 3, 2, 1]
  const thresholds = nice.filter(n => n <= max)

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

  while (bands.length > 12) {
    const last = bands.pop()!
    const prev = bands[bands.length - 1]
    prev.label = `${last.min}–${prev.max === Infinity ? prev.min + '+' : prev.max}`
    prev.min = last.min
  }

  return bands
}

function getRelationship(did: string, followerDids?: Set<string>, followingDids?: Set<string>): Relationship | null {
  const isFollower = followerDids?.has(did) ?? false
  const isFollowing = followingDids?.has(did) ?? false
  if (isFollower && isFollowing) return 'mutual'
  if (isFollowing) return 'following'
  if (isFollower) return 'follower'
  return null
}

const REL_STYLES: Record<Relationship, { border: string; bg: string }> = {
  follower:  { border: 'border-teal',   bg: 'bg-teal-faint' },
  following: { border: 'border-coral',   bg: 'bg-coral-faint' },
  mutual:    { border: 'border-violet',  bg: 'bg-violet-faint' },
}

function tileClasses(did: string, followerDids?: Set<string>, followingDids?: Set<string>): string {
  const rel = getRelationship(did, followerDids, followingDids)
  if (rel) {
    const s = REL_STYLES[rel]
    return `border-2 ${s.border} ${s.bg}`
  }
  return 'border border-cream-dark bg-white'
}

export function FollowerLocations({ followers, followerDids, followingDids, nearbyProfiles, detectedCity }: Props) {
  const [activeBand, setActiveBand] = useState(0)
  const [localityActive, setLocalityActive] = useState(false)
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null)
  const [tileCounts, setTileCounts] = useState<Record<string, number>>({})
  const [grouping, setGrouping] = useState<Grouping>('specific')
  const [showNearby, setShowNearby] = useState(true)
  const [nearbyVisible, setNearbyVisible] = useState(TILE_PAGE_SIZE)

  const hasRelData = !!(followerDids || followingDids)

  const rawResult: FollowerLocationResult = useMemo(
    () => scanFollowerLocations(followers),
    [followers],
  )

  const result = useMemo(
    () => regroupResult(rawResult, grouping),
    [rawResult, grouping],
  )

  const followersByHandle = useMemo(() => {
    const map = new Map<string, EnrichedFollower>()
    for (const f of followers) map.set(f.handle, f)
    return map
  }, [followers])

  const bands = useMemo(() => computeBands(result.ranked), [result.ranked])

  // Which location row should show nearby results at the current grouping level
  const nearbyLocationKey = useMemo(
    () => detectedCity ? groupLocation(detectedCity, grouping) : null,
    [detectedCity, grouping],
  )

  // Locality band: the user's own city/region/country at the current grouping level
  const localityLocations = useMemo(() => {
    if (!nearbyLocationKey) return []
    return result.ranked.filter(([loc]) => loc === nearbyLocationKey)
  }, [nearbyLocationKey, result.ranked])

  const hasLocality = localityLocations.length > 0 && !!detectedCity

  // Short label for the locality pill — just the first part(s) matching the grouping
  const localityLabel = useMemo(() => {
    if (!nearbyLocationKey) return ''
    const parts = nearbyLocationKey.split(',').map(s => s.trim())
    if (parts.length <= 1) return nearbyLocationKey
    // Drop the last part (country) for a shorter label, unless it's the only part
    return parts.slice(0, -1).join(', ')
  }, [nearbyLocationKey])

  const detectedPct = result.total > 0 ? Math.round((result.detected / result.total) * 100) : 0
  const maxCount = result.ranked[0]?.[1] ?? 1

  const safeBand = activeBand < bands.length ? activeBand : 0
  const currentBand = bands[safeBand]
  const bandLocations = localityActive
    ? localityLocations
    : currentBand
      ? result.ranked.filter(([, count]) => count >= currentBand.min && count <= currentBand.max)
      : []

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-bold text-navy tracking-wide uppercase">Locals</h2>
        <p className="text-xs text-navy-faint">
          {result.detected} of {result.total} accounts ({detectedPct}%) have a detectable location
        </p>
      </div>

      {/* Legend + grouping controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasRelData && (
          <div className="flex gap-4 text-xs">
            {([
              ['follower', 'Follows you', 'bg-teal-faint border-teal'],
              ['following', 'You follow', 'bg-coral-faint border-coral'],
              ['mutual', 'Mutual', 'bg-violet-faint border-violet'],
            ] as [Relationship, string, string][]).map(([, label, cls]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-3.5 h-3.5 rounded border-2 ${cls} inline-block`} />
                <span className="text-navy-faint font-medium">{label}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 bg-white rounded-full border border-cream-dark p-0.5">
          {GROUPING_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setGrouping(opt.value); setActiveBand(0); setLocalityActive(false); setExpandedLocation(null) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                grouping === opt.value
                  ? 'bg-blue text-white'
                  : 'text-navy-faint hover:text-navy'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
          {(bands.length > 1 || hasLocality) && (
            <div className="flex flex-wrap gap-1.5">
              {hasLocality && (
                <button
                  onClick={() => { setLocalityActive(true); setExpandedLocation(null) }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                    localityActive
                      ? 'bg-gold text-white'
                      : 'bg-white border border-gold text-gold hover:bg-gold-faint'
                  }`}
                >
                  {localityLabel} <span className="opacity-70">({localityLocations.reduce((sum, [, c]) => sum + c, 0)})</span>
                </button>
              )}
              {bands.map((band, i) => {
                const count = result.ranked.filter(([, c]) => c >= band.min && c <= band.max).reduce((sum, [, c]) => sum + c, 0)
                return (
                  <button
                    key={band.label}
                    onClick={() => { setActiveBand(i); setLocalityActive(false); setExpandedLocation(null) }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      !localityActive && safeBand === i
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

                  {isExpanded && (() => {
                    const hasNearby = nearbyLocationKey === location && nearbyProfiles && nearbyProfiles.length > 0
                    return (
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
                              className={`flex flex-col items-center text-center p-4 rounded-lg ${tileClasses(follower.did, followerDids, followingDids)} hover:shadow-sm transition-all no-underline`}
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

                      {/* Nearby people from search — inline within the matching city */}
                      {hasNearby && (
                        <div className="mt-4 pt-4 border-t border-cream-dark">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-medium text-navy">
                              Others in {detectedCity?.split(',')[0]} <span className="text-navy-faint font-normal">({nearbyProfiles!.length} from search)</span>
                            </p>
                            <button
                              onClick={() => setShowNearby(v => !v)}
                              className="text-xs text-blue hover:text-blue-light font-medium cursor-pointer"
                            >
                              {showNearby ? 'Hide' : 'Show'}
                            </button>
                          </div>
                          {showNearby && (
                            <>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {nearbyProfiles!.slice(0, nearbyVisible).map(p => (
                                  <a
                                    key={p.did}
                                    href={`https://bsky.app/profile/${p.handle}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex flex-col items-center text-center p-4 rounded-lg border border-dashed border-cream-dark bg-white hover:shadow-sm transition-all no-underline"
                                  >
                                    {p.avatar ? (
                                      <img src={p.avatar} alt="" className="w-[84px] h-[84px] rounded-full" />
                                    ) : (
                                      <div className="w-[84px] h-[84px] rounded-full bg-cream-dark" />
                                    )}
                                    <span className="font-medium text-navy text-sm mt-2 truncate w-full">
                                      {p.displayName || p.handle}
                                    </span>
                                    <span className="text-xs text-navy-faint truncate w-full">@{p.handle}</span>
                                    {p.sharedFollowsCount > 0 && (
                                      <span className="text-xs text-blue mt-1">
                                        {p.sharedFollowsCount} shared
                                      </span>
                                    )}
                                  </a>
                                ))}
                              </div>
                              {nearbyProfiles!.length > nearbyVisible && (
                                <button
                                  onClick={() => setNearbyVisible(v => v + TILE_PAGE_SIZE)}
                                  className="w-full mt-3 py-2 text-sm text-blue hover:text-blue-light font-medium hover:bg-blue-faint rounded-lg transition-colors cursor-pointer"
                                >
                                  Show more ({nearbyVisible} of {nearbyProfiles!.length})
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
