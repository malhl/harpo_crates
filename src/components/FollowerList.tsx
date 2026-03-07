/**
 * FollowerList.tsx — Sortable, filterable list of analyzed followers.
 *
 * Renders a scrollable list of follower cards with text search and sort controls.
 */

import { useState, useMemo } from 'react'
import type { EnrichedFollower } from '../types'
import { formatNumber } from '../utils/stats'

type SortKey = 'followers' | 'posts' | 'follows' | 'name'

interface Props {
  followers: EnrichedFollower[]
}

export function FollowerList({ followers }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('followers')
  const [sortDesc, setSortDesc] = useState(true)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = followers
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(f =>
        f.handle.toLowerCase().includes(q) ||
        f.displayName.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'followers': cmp = a.followersCount - b.followersCount; break
        case 'posts': cmp = a.postsCount - b.postsCount; break
        case 'follows': cmp = a.followsCount - b.followsCount; break
        case 'name': cmp = (a.displayName || a.handle).localeCompare(b.displayName || b.handle); break
      }
      return sortDesc ? -cmp : cmp
    })
  }, [followers, search, sortBy, sortDesc])

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDesc(!sortDesc)
    else { setSortBy(key); setSortDesc(true) }
  }

  const SortButton = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <button
      onClick={() => toggleSort(sortKey)}
      className={`text-xs px-2 py-1 rounded transition-colors ${
        sortBy === sortKey ? 'bg-sky-100 text-sky-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label} {sortBy === sortKey && (sortDesc ? '↓' : '↑')}
    </button>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter followers..."
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>Sort:</span>
          <SortButton label="Followers" sortKey="followers" />
          <SortButton label="Posts" sortKey="posts" />
          <SortButton label="Following" sortKey="follows" />
          <SortButton label="Name" sortKey="name" />
        </div>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} results</span>
      </div>

      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">No followers match this filter.</p>
        )}
        {filtered.map(follower => (
          <div
            key={follower.did}
            className="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-100 hover:border-gray-200 transition-colors"
          >
            {follower.avatar ? (
              <img src={follower.avatar} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-gray-900 text-sm truncate">
                  {follower.displayName || follower.handle}
                </span>
                <span className="text-xs text-gray-400 truncate">@{follower.handle}</span>
              </div>
              {follower.description && (
                <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{follower.description}</p>
              )}
              <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                <span>{formatNumber(follower.followersCount)} followers</span>
                <span>{formatNumber(follower.postsCount)} posts</span>
                <span>{formatNumber(follower.followsCount)} following</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
