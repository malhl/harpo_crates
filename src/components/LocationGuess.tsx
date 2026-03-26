/**
 * LocationGuess.tsx — Infer and display a user's likely location from their
 * profile bio, posting times, and post content. Runs entirely client-side
 * using the public Bluesky API. Features a heat scale for confidence.
 */

import { useState, useEffect, useRef } from 'react'
import { getProfile, fetchPostsForLocation } from '../api/bluesky'
import { inferLocation, type LocationGuess as LocationGuessType, type LocationSignal } from '../utils/locationInference'

interface Props {
  handle: string
  /** If true, automatically start analysis on mount */
  autoRun?: boolean
}

const SOURCE_LABELS: Record<string, string> = {
  bio: 'Profile Bio',
  timezone: 'Posting Times',
  posts: 'Post Content',
}

const SOURCE_ICONS: Record<string, string> = {
  bio: '\u{1F4CB}',
  timezone: '\u{1F552}',
  posts: '\u{1F4AC}',
}

const SPECIFICITY_LABELS: Record<string, string> = {
  exact: 'Self-reported location',
  city: 'City-level estimate',
  region: 'Region-level estimate',
  timezone: 'Timezone-level estimate',
  unknown: 'No data',
}

/** Returns a Tailwind-compatible HSL color interpolated from blue (cold) → red (hot) */
function heatColor(heat: number): string {
  // 0 = blue (210°), 100 = red (0°)
  const hue = Math.round(210 - (heat / 100) * 210)
  return `hsl(${hue}, 80%, 50%)`
}

/** The segmented heat bar — 10 blocks that fill from left to right */
function HeatBar({ heat, size = 'normal' }: { heat: number; size?: 'normal' | 'small' }) {
  const segments = 10
  const filled = Math.round((heat / 100) * segments)
  const h = size === 'small' ? 'h-2' : 'h-3'

  return (
    <div className="flex items-center gap-1">
      <div className={`flex gap-0.5 ${h}`}>
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={`${size === 'small' ? 'w-2' : 'w-3'} rounded-sm transition-all`}
            style={{
              backgroundColor: i < filled ? heatColor((i / segments) * 100) : undefined,
            }}
          >
            {i >= filled && (
              <div className={`w-full ${h} rounded-sm bg-cream-dark`} />
            )}
          </div>
        ))}
      </div>
      <span className={`font-bold ml-1 ${size === 'small' ? 'text-xs' : 'text-sm'}`} style={{ color: heatColor(heat) }}>
        {heat}
      </span>
    </div>
  )
}

export function LocationGuess({ handle, autoRun }: Props) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [guess, setGuess] = useState<LocationGuessType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null)
  const didAutoRun = useRef(false)

  useEffect(() => {
    if (autoRun && !didAutoRun.current) {
      didAutoRun.current = true
      run()
    }
  }, [autoRun])

  const run = async () => {
    setLoading(true)
    setError(null)
    setGuess(null)
    setExpandedSignal(null)

    try {
      setStatus('Fetching profile...')
      const profile = await getProfile(handle)
      const bio = profile.description ?? ''

      setStatus('Pulling posts (this may take a moment)...')
      const { texts, timestamps } = await fetchPostsForLocation(handle, (n) => {
        setStatus(`Pulled ${n} posts so far...`)
      })

      setStatus('Analyzing...')
      const result = inferLocation(bio, texts, timestamps)
      setGuess(result)
      setStatus('')
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      {!guess && (
        <button
          onClick={run}
          disabled={loading}
          className="w-full bg-navy hover:bg-navy-light disabled:opacity-50 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? status || 'Working...' : 'Where are they posting from?'}
        </button>
      )}

      {error && (
        <div className="mt-3 bg-burgundy-faint border border-burgundy text-burgundy rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {guess && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {/* Header with best guess and overall heat */}
          <div className="px-5 py-4 border-b border-cream-dark">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-navy">
                  {guess.bestGuess ?? 'Unknown location'}
                </h3>
                <p className="text-xs text-navy-faint mt-0.5">
                  {SPECIFICITY_LABELS[guess.specificity]}
                </p>
              </div>
              <button
                onClick={() => { setGuess(null); setExpandedSignal(null) }}
                className="text-xs text-navy-faint hover:text-navy transition-colors cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>

            {/* Overall heat bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-navy-faint">Confidence</span>
              </div>
              <HeatBar heat={guess.heat} />
            </div>
          </div>

          {/* Signal breakdown */}
          {guess.signals.length > 0 && (
            <div className="divide-y divide-cream-dark">
              {guess.signals.map((signal, i) => (
                <SignalRow
                  key={i}
                  signal={signal}
                  expanded={expandedSignal === i}
                  onToggle={() => setExpandedSignal(expandedSignal === i ? null : i)}
                />
              ))}
            </div>
          )}

          {guess.signals.length === 0 && (
            <div className="px-5 py-4 text-sm text-navy-faint">
              No location signals found in their bio, posting times, or post content.
            </div>
          )}

          {/* Disclaimer */}
          <div className="px-5 py-3 bg-cream text-xs text-navy-faint">
            Rough estimate from public data. Bio self-reports are most reliable.
            Timezone + post cross-referencing is speculative.
          </div>
        </div>
      )}
    </div>
  )
}

function SignalRow({ signal, expanded, onToggle }: { signal: LocationSignal; expanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-5 py-3 flex items-center gap-3 hover:bg-cream/50 transition-colors text-left cursor-pointer"
      >
        <span className="text-lg">{SOURCE_ICONS[signal.source]}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-navy">{signal.label}</div>
          <div className="text-xs text-navy-faint">{SOURCE_LABELS[signal.source]}</div>
        </div>
        <HeatBar heat={signal.heat} size="small" />
        <span className="text-navy-faint text-xs ml-1">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="px-5 pb-3 pl-12">
          <pre className="text-xs text-navy-light whitespace-pre-wrap font-mono bg-cream rounded p-3">
            {signal.detail}
          </pre>
        </div>
      )}
    </div>
  )
}
