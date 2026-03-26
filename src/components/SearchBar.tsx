/**
 * SearchBar.tsx — Handle input, mode selector, and search trigger component.
 *
 * Renders a form with a text input for the Bluesky handle, a dropdown to
 * select which analysis mode to run, an "Analyze" button, and a conditional
 * "Clear" button that appears after results are loaded.
 */

import { useState } from 'react'
import { ANALYSIS_MODES, type AnalysisMode } from '../types'

interface Props {
  onSearch: (handle: string, mode: AnalysisMode) => void
  loading: boolean
  onReset: () => void
  hasResult: boolean
}

export function SearchBar({ onSearch, loading, onReset, hasResult }: Props) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<AnalysisMode>('all')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const handle = input.trim().replace(/^@/, '')
    if (handle) onSearch(handle, mode)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-3">
      <div className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter full handle (e.g. my-username.bsky.social)"
          disabled={loading}
          className="flex-1 px-4 py-3 rounded-lg border border-cream-dark bg-white text-navy placeholder-navy-faint focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent disabled:opacity-50 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-6 py-3 bg-blue text-white rounded-lg font-medium hover:bg-blue-light focus:outline-none focus:ring-2 focus:ring-blue focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
        {hasResult && (
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-3 bg-cream-dark text-navy-light rounded-lg font-medium hover:bg-cream transition-colors text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {/* Mode selector */}
      <div className="flex items-center gap-2 justify-center">
        {ANALYSIS_MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            disabled={loading}
            onClick={() => setMode(value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${
              mode === value
                ? 'bg-blue text-white'
                : 'bg-white text-navy-faint border border-cream-dark hover:border-blue hover:text-navy'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </form>
  )
}
