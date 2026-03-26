# Harpo Crates — Bluesky Follower Analyzer

A client-side web app that lets you enter any Bluesky handle and get a detailed breakdown of their followers.

No login required. No backend server. No data stored. All analysis happens in your browser using the public AT Protocol API.

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

Open `http://localhost:5173` and enter a Bluesky handle (e.g. `user.bsky.social`).

## Tech Stack

| Technology | Purpose |
|---|---|
| **React 19** | UI framework with hooks-based architecture |
| **TypeScript** | Static type checking across the entire codebase |
| **Vite** | Build tool, dev server, and HMR (Hot Module Replacement) |
| **Tailwind CSS v4** | Utility-first styling via the Vite plugin with custom theme colors |
| **@atproto/api** | Official AT Protocol SDK for type-safe Bluesky API calls |
| **Vitest** | Unit and integration testing framework |
| **React Testing Library** | Component testing with user-centric queries |

## Analysis Modes

Choose an analysis mode before searching to control which pipeline steps run:

| Mode | Label | What it does |
|---|---|---|
| **Full Analysis** | Full Analysis | Runs the complete pipeline: profile, followers, following, enrichment, interactions, shared follows, and stats |
| **Besties** | Besties | Profile + followers + following + enrichment + interaction scoring (skips shared follows) |
| **Inner Circle** | Inner Circle | Profile + followers + following + enrichment + shared follows (skips interactions) |
| **Locals** | Locals | Profile + followers only — scans all follower bios for location signals and displays an aggregate geographic breakdown |
| **Lurkers** | Lurkers | Profile + followers + following + enrichment only (skips both interactions and shared follows) |

Each mode skips unnecessary heavy API steps, so lighter modes like Locals complete much faster than a Full Analysis.

## How It Works

When you enter a Bluesky handle, Harpo Crates runs a multi-step analysis pipeline entirely in your browser:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  1. Profile  │────▶│  2. Followers    │────▶│  3. Following    │
│  Lookup      │     │  (paginated)     │     │  (for mutuals)   │
└─────────────┘     └──────────────────┘     └──────────────────┘
                                                      │
┌─────────────┐     ┌──────────────────┐              │
│  8. Stats &  │◀───│  4. Enrich       │◀─────────────┘
│  Dashboard   │     │  Profiles        │
└─────────────┘     └──────────────────┘
        ▲                     │
        │           ┌──────────────────┐
        │           │  5. Interactions │
        │           │  (besties)       │
        │           └──────────────────┘
        │                     │
        │           ┌──────────────────┐
        └───────────│  6. Shared       │
                    │  Follows         │
                    └──────────────────┘
```

A single cumulative progress bar with elapsed timer tracks overall progress across all phases, dynamically adjusting its estimate as actual counts come in from pagination. API calls are parallelized where possible (3 concurrent requests) to maximize speed while staying within rate limits.

### Step 1: Profile Lookup
Calls `app.bsky.actor.getProfile` to fetch the target user's full profile, including avatar, banner, bio, and aggregate counts (followers, following, posts).

### Step 2: Follower Collection
Paginates through `app.bsky.graph.getFollowers`, fetching 100 followers per API call with cursor-based pagination. The array order is preserved to track follow order (oldest to newest).

### Step 3: Following Collection
Fetches the target user's following list via `app.bsky.graph.getFollows` using the same pagination pattern. This is used for mutual detection and shared follows computation.

### Step 4: Profile Enrichment
The follower list from Step 2 contains lightweight `ProfileView` objects that lack follower/following/post counts. Harpo Crates batch-fetches full `ProfileViewDetailed` objects via `app.bsky.actor.getProfiles` (up to 25 per request).

### Step 5: Interaction Scoring (Besties)
A 3-phase algorithm computes bidirectional interaction scores:
- **Phase 1 — Incoming:** Fetches the target's posts from the last year and scores everyone who liked, replied, reposted, or quoted them (3 API calls per post, fired in parallel). The top 100 scorers become "friends."
- **Phase 2 — Outgoing:** For each friend, fetches their posts and checks if the target liked them. Also extracts outgoing replies, quotes, and reposts from the target's feed. Up to 3 friends processed concurrently.
- **Thread Bonus:** Detects long threads where both the target and another person replied 3+ times. Each qualifying thread adds `10 × (target_extra + other_extra)` bonus points, where extras are replies beyond the 3-reply threshold.
- **Phase 3 — Closeness:** Combines scores using geometric mean (`sqrt(incoming × outgoing)`) plus any thread bonus, which favors balanced mutual interaction. Returns the top 20.

### Step 6: Shared Follows (Inner Circle)
For each follower, fetches their following list and counts how many accounts they follow that the target also follows. Processes 3 followers concurrently. The top 20 by overlap are displayed.

### Step 7: Statistics & Dashboard
Aggregate statistics are computed across all enriched followers, and the dashboard renders with overview cards, follower categories, and a sortable/filterable tile grid.

### Rate Limiting
A 200ms delay is inserted between API requests, with up to 3 concurrent requests where safe, to stay within the public API's limit of ~3,000 requests per 5 minutes per IP. The interaction scoring and shared follows phases are the most API-intensive parts of the pipeline.

## Current Features

### Profile Summary Card

- **Banner image** and **avatar** with overlapping layout
- **Display name and @handle**
- **Bio text** with preserved line breaks
- **Follower, following, and post counts** formatted with K/M suffixes
- **Account creation date**

### Dashboard

**Overview Stats** (4 cards):
- **Total Active Followers** — count of accessible followers (excludes deleted/suspended accounts)
- **Mutuals** — how many followers the target user follows back
- **Avg Followers** — average follower count across all followers
- **Avg Posts** — average post count across all followers

**Follower Categories**:
- **Besties** — followers you interact with most, scored by mutual likes, replies, quotes, reposts, and long threads over the last year. Uses closeness-weighted scoring that favors balanced two-way interaction, with bonus points for deep conversation threads. Top 20.
- **Inner Circle** — followers who share the most follows with you, ranked by how many accounts you both follow. Top 20.
- **Ghosts** — followers with no activity in 6+ months (based on profile `indexedAt`). Sorted by last activity, oldest first.
- **Lurkers** — followers with <100 posts and accounts 6+ months old, or <10 posts and 1+ month old. Sorted by follow order (longest-following first). Expandable with "Show more" pagination.

**All Followers** (tile grid, sortable, filterable):
- Each follower tile shows: avatar, display name, @handle, join date, follower/following/post counts
- Clicking a tile opens their Bluesky profile in a new tab
- **Sort** by oldest follow, followers, posts, following count, or name (ascending/descending toggle)
- **Text search** filters across handle, display name, and bio content
- **"Show more" pagination** loads 52 tiles at a time

### Locals (Follower Location Breakdown)

Scans all follower bios for location signals and displays a ranked geographic breakdown:

- **Detection methods** (in priority order):
  1. **Bio patterns** — "Based in...", "Living in...", "📍", "City, ST" formats
  2. **City keyword matching** — recognizes 100+ major cities worldwide
  3. **Alias matching** — abbreviations like ATL, PDX, UK, etc.
- **Normalization** — merges variants ("Seattle, WA" + "Seattle" → "Seattle, WA, US") with state/province labels for US, Canadian, and Australian cities
- **Count-based band paging** — locations grouped into ~10 pages by follower count (e.g. "50+", "20–49", "10–19")
- **Expandable tiles** — click any location to see follower tiles (avatar, name, handle) sorted alphabetically
- **Proportional bars** — each location row shows a background bar scaled relative to the top location

### Color Palette

Custom warm palette with navy, blue, gold, burgundy, and cream tones defined via Tailwind CSS v4 `@theme` configuration.

## Architecture

```
src/
├── api/
│   └── bluesky.ts              # AT Protocol API service layer
│
├── components/
│   ├── SearchBar.tsx            # Handle input + analysis mode selector
│   ├── ProfileSummary.tsx       # Target user's profile card
│   ├── LoadingProgress.tsx      # Cumulative analysis progress bar
│   ├── FollowerDashboard.tsx    # Overview stats + categories + follower list
│   ├── FollowerLocations.tsx    # Aggregate follower location breakdown (Locals mode)
│   ├── CategorySection.tsx      # Expandable category with tile grid
│   └── FollowerList.tsx         # Sortable/filterable follower tile grid
│
├── hooks/
│   └── useFollowerAnalysis.ts   # Mode-aware analysis pipeline orchestrator
│
├── utils/
│   ├── stats.ts                 # Statistics computation and formatting
│   ├── locationInference.ts     # Bio location parsing, normalization, and batch scanning
│   └── debug.ts                 # Debug logging utilities
│
├── types/
│   └── index.ts                 # TypeScript type definitions, modes, and category configs
│
├── App.tsx                      # Root component
├── main.tsx                     # Entry point
└── index.css                    # Tailwind CSS import and custom theme
```

## API Reference

| Endpoint | Purpose | Pagination |
|---|---|---|
| `app.bsky.actor.getProfile` | Fetch a user's full profile | N/A |
| `app.bsky.graph.getFollowers` | List accounts that follow a user | Cursor-based, max 100/page |
| `app.bsky.graph.getFollows` | List accounts a user follows | Cursor-based, max 100/page |
| `app.bsky.actor.getProfiles` | Batch-fetch full profiles by DID | Max 25 actors per request |
| `app.bsky.feed.getAuthorFeed` | Fetch a user's posts | Cursor-based, max 100/page |
| `app.bsky.feed.getLikes` | Get who liked a post | Cursor-based, max 100/page |
| `app.bsky.feed.getPostThread` | Get replies to a post | N/A (depth param) |
| `app.bsky.feed.getRepostedBy` | Get who reposted a post | Cursor-based, max 100/page |

**Base URL:** `https://public.api.bsky.app/xrpc/`

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Planned Features

- **Growth tracking** — store snapshots in localStorage to track follower changes over time
- **Data export** — CSV/JSON export of follower data
- **Comparison mode** — compare two users' follower bases
- **Optional OAuth login** — higher rate limits, outgoing like detection, and moderation list access
- **Visualizations** — charts, network graphs, and activity heatmaps
- **Shareable results** — generate summary cards and shareable links

## License

MIT
