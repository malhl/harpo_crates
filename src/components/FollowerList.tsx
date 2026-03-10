/**
 * FollowerList.tsx — Sortable, filterable list of analyzed followers.
 *
 * Renders a scrollable list of follower cards with text search and sort controls.
 */

import { useState, useMemo } from 'react'
import type { EnrichedFollower } from '../types'
import { formatNumber } from '../utils/stats'

type SortKey = 'followers' | 'posts' | 'follows' | 'name' | 'followOrder'

const PAGE_SIZE = 52

interface Props {
  followers: EnrichedFollower[]
}

export function FollowerList({ followers }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('followOrder')
  const [sortDesc, setSortDesc] = useState(true)
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

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
        case 'followOrder': cmp = a.followerIndex - b.followerIndex; break
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
        sortBy === sortKey ? 'bg-blue-faint text-blue font-medium' : 'text-navy-faint hover:bg-cream-dark'
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
          className="px-3 py-1.5 border border-cream-dark rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent"
        />
        <div className="flex items-center gap-1 text-xs text-navy-faint">
          <span>Sort:</span>
          <SortButton label="Oldest" sortKey="followOrder" />
          <SortButton label="Followers" sortKey="followers" />
          <SortButton label="Posts" sortKey="posts" />
          <SortButton label="Following" sortKey="follows" />
          <SortButton label="Name" sortKey="name" />
        </div>
        <span className="text-xs text-navy-faint ml-auto">{filtered.length} results</span>
      </div>

      <div>
        {filtered.length === 0 && (
          <p className="text-sm text-navy-faint text-center py-8">No followers match this filter.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.slice(0, visibleCount).map(follower => (
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
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-xs text-navy-faint">
                {follower.createdAt && (
                  <span className="col-span-2">Joined {new Date(follower.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                )}
                <span>{formatNumber(follower.followersCount)} followers</span>
                <span>{formatNumber(follower.followsCount)} following</span>
                <span className="col-span-2">{formatNumber(follower.postsCount)} posts</span>
              </div>
            </a>
          ))}
        </div>
        {filtered.length > visibleCount && (
          <button
            onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
            className="w-full mt-3 py-2 text-sm text-blue hover:text-blue-light font-medium hover:bg-blue-faint rounded-lg transition-colors"
          >
            Show more ({visibleCount} of {filtered.length})
          </button>
        )}
      </div>
    </div>
  )
}
