import { useState, useMemo } from 'react'
import type { EnrichedFollower, FollowerCategoryDef } from '../types'
import { formatNumber } from '../utils/stats'

interface Props {
  category: FollowerCategoryDef
  followers: EnrichedFollower[]
}

const PAGE_SIZE = 52

export function CategorySection({ category, followers }: Props) {
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const allMatched = useMemo(() => {
    const filtered = followers.filter(category.filter)
    const sorted = [...filtered].sort((a, b) => {
      const diff = a[category.sortKey] - b[category.sortKey]
      return category.sortAsc ? diff : -diff
    })
    return sorted
  }, [followers, category])

  const total = allMatched.length
  const matched = allMatched.slice(0, visibleCount)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-cream-dark hover:border-navy-faint transition-colors text-left"
      >
        <div>
          <span className="font-medium text-navy">{category.label}</span>
          <span className="ml-2 text-sm text-navy-faint">({total})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-navy-faint">{category.description}</span>
          <span className="text-navy-faint">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-2 max-h-[500px] overflow-y-auto pr-1">
          {matched.length === 0 && (
            <p className="text-sm text-navy-faint text-center py-4">No followers match this category.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {matched.map(follower => (
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
          {total > matched.length && (
            <button
              onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
              className="w-full mt-3 py-2 text-sm text-blue hover:text-blue-light font-medium hover:bg-blue-faint rounded-lg transition-colors"
            >
              Show more ({matched.length} of {total})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
