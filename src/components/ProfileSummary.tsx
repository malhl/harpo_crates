/**
 * ProfileSummary.tsx — Profile card for the analyzed Bluesky account.
 *
 * Displays the target user's profile information in a card layout with:
 *   - Banner image (if available) as a background strip
 *   - Avatar overlapping the banner/card boundary
 *   - Display name and @handle
 *   - Bio text (preserving newlines with whitespace-pre-wrap)
 *   - Follower, following, and post counts (formatted with K/M suffixes)
 *   - Account creation date in a human-readable format
 *
 * This component only renders when an analysis is complete and the profile
 * data is available. It sits at the top of the results area, above the
 * follower dashboard.
 */

import type { ProfileViewDetailed } from '../types'
import { formatNumber } from '../utils/stats'

interface Props {
  profile: ProfileViewDetailed
}

export function ProfileSummary({ profile }: Props) {
  // Format the creation date for display (e.g. "March 15, 2023")
  const createdDate = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Banner image — only rendered if the user has one set */}
      {profile.banner && (
        <div className="h-32 w-full bg-sky-100">
          <img src={profile.banner} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-6">
        <div className="flex items-start gap-4">
          {/* Avatar — overlaps the banner with negative margin for the overlapping card effect */}
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt={profile.displayName ?? profile.handle}
              className="w-20 h-20 rounded-full border-4 border-white -mt-12 shadow-md"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-300 -mt-12 border-4 border-white shadow-md" />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 truncate">
              {profile.displayName || profile.handle}
            </h2>
            <p className="text-sm text-gray-500">@{profile.handle}</p>
          </div>
        </div>

        {/* Bio text — whitespace-pre-wrap preserves the user's line breaks */}
        {profile.description && (
          <p className="mt-3 text-gray-700 text-sm whitespace-pre-wrap">{profile.description}</p>
        )}

        {/* Stats row — followers, following, posts, join date */}
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="font-bold text-gray-900">{formatNumber(profile.followersCount ?? 0)}</span>
            <span className="text-gray-500 ml-1">followers</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">{formatNumber(profile.followsCount ?? 0)}</span>
            <span className="text-gray-500 ml-1">following</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">{formatNumber(profile.postsCount ?? 0)}</span>
            <span className="text-gray-500 ml-1">posts</span>
          </div>
          {createdDate && (
            <div>
              <span className="text-gray-500">Joined </span>
              <span className="font-medium text-gray-700">{createdDate}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
