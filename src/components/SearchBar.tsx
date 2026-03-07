/**
 * SearchBar.tsx — Handle input and search trigger component.
 *
 * Renders a form with a text input for the Bluesky handle, an "Analyze" button,
 * and a conditional "Clear" button that appears after results are loaded.
 *
 * The input accepts handles with or without a leading "@" — the "@" is
 * automatically stripped before the search is triggered. The form is disabled
 * while an analysis is in progress to prevent concurrent requests.
 */

import { useState } from 'react'

interface Props {
  /** Called with the cleaned handle when the user submits the form */
  onSearch: (handle: string) => void
  /** Whether an analysis is currently in progress (disables the form) */
  loading: boolean
  /** Called when the user clicks "Clear" to reset back to the empty state */
  onReset: () => void
  /** Whether analysis results are currently displayed (shows the Clear button) */
  hasResult: boolean
}

export function SearchBar({ onSearch, loading, onReset, hasResult }: Props) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Strip leading "@" since users often copy handles with it included
    const handle = input.trim().replace(/^@/, '')
    if (handle) onSearch(handle)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl mx-auto flex gap-3">
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Enter a Bluesky handle (e.g. user.bsky.social)"
        disabled={loading}
        className="flex-1 px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50 text-sm"
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-sky-500 text-white rounded-lg font-medium hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {loading ? 'Analyzing...' : 'Analyze'}
      </button>
      {hasResult && (
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors text-sm"
        >
          Clear
        </button>
      )}
    </form>
  )
}
