/**
 * App.tsx — Root application component for Harpo Crates.
 *
 * Orchestrates the top-level layout and application state flow:
 *
 *   1. Header — app title and tagline
 *   2. SearchBar — handle input + mode selector that triggers analysis
 *   3. LoadingProgress — progress bar during analysis (auto-hides when idle/done)
 *   4. Error display — shown if any pipeline step fails
 *   5. Results — mode-dependent: ProfileSummary + LocationGuess or FollowerDashboard
 *   6. Empty state — shown before any search is performed
 *   7. Footer — privacy note about client-side-only processing
 *
 * All state management is handled by the useFollowerAnalysis hook, which
 * exposes progress, result, error, mode, analyze, and reset.
 */

import harpoCrateLogo from './assets/lyre_crate_logo.svg'
import { SearchBar } from './components/SearchBar'
import { LoadingProgress } from './components/LoadingProgress'
import { ProfileSummary } from './components/ProfileSummary'
import { FollowerDashboard } from './components/FollowerDashboard'
import { FollowerLocations } from './components/FollowerLocations'
import { useFollowerAnalysis } from './hooks/useFollowerAnalysis'

function App() {
  const { progress, result, error, mode, analyze, reset, abort } = useFollowerAnalysis()
  const loading = !['idle', 'done', 'error'].includes(progress.phase)

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="bg-navy border-b border-navy-light">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col items-center">
          <img src={harpoCrateLogo} alt="Harpo Crates logo" className="w-16 h-16 mb-2" />
          <h1 className="text-2xl font-bold text-white text-center">
            Harpo Crates
          </h1>
          <p className="text-sm text-navy-faint text-center mt-1">
            Analyze Any Bluesky Account
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Search + mode selector */}
        <SearchBar
          onSearch={analyze}
          loading={loading}
          onReset={reset}
          hasResult={!!result}
        />

        {/* Progress bar */}
        <LoadingProgress progress={progress} onTimeout={abort} />

        {/* Error state */}
        {error && (
          <div className="max-w-xl mx-auto bg-burgundy-faint border border-burgundy text-burgundy rounded-lg p-4 text-sm">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {/* Results — mode-dependent rendering */}
        {result && mode === 'location' && (
          <div className="space-y-8">
            <ProfileSummary profile={result.profile} />
            <FollowerLocations followers={result.followers} followerDids={result.followerDids} followingDids={result.followingDids} />
          </div>
        )}

        {result && mode !== 'location' && (
          <div className="space-y-8">
            <ProfileSummary profile={result.profile} />
            <FollowerDashboard result={result} mode={mode} />
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="text-center py-16">
            <p className="text-navy-faint text-lg">
              Enter a Bluesky handle above to get started
            </p>
            <p className="text-navy-faint text-sm mt-2">
              No login required — all data is fetched from the public API
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-cream-dark mt-16">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-navy-faint space-y-1">
          <p>Harpo Crates uses the public AT Protocol API. No data is stored or transmitted to any server.</p>
          <p>v{__APP_VERSION__} · {__BUILD_DATE__} · Built by <a href="https://github.com/malhl" target="_blank" rel="noopener noreferrer" className="underline hover:text-navy">malhl</a></p>
        </div>
      </footer>
    </div>
  )
}

export default App
