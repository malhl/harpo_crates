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
| **Tailwind CSS v4** | Utility-first styling via the Vite plugin |
| **@atproto/api** | Official AT Protocol SDK for type-safe Bluesky API calls |
| **Vitest** | Unit and integration testing framework |
| **React Testing Library** | Component testing with user-centric queries |

## How It Works

When you enter a Bluesky handle, Harpo Crates runs a multi-step analysis pipeline entirely in your browser:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  1. Profile  │────▶│  2. Followers    │────▶│  3. Following    │
│  Lookup      │     │  (paginated)     │     │  (for mutuals)   │
└─────────────┘     └──────────────────┘     └──────────────────┘
                                                      │
┌─────────────┐     ┌──────────────────┐              │
│  5. Stats &  │◀───│  4. Enrich       │◀─────────────┘
│  Dashboard   │     │  Profiles        │
└─────────────┘     └──────────────────┘
```

### Step 1: Profile Lookup
Calls `app.bsky.actor.getProfile` to fetch the target user's full profile, including avatar, banner, bio, and aggregate counts (followers, following, posts).

### Step 2: Follower Collection
Paginates through `app.bsky.graph.getFollowers`, fetching 100 followers per API call with cursor-based pagination.

### Step 3: Following Collection
Fetches the target user's following list via `app.bsky.graph.getFollows` using the same pagination pattern. This is used for mutual detection.

### Step 4: Profile Enrichment
The follower list from Step 2 contains lightweight `ProfileView` objects that lack follower/following/post counts. Harpo Crates batch-fetches full `ProfileViewDetailed` objects via `app.bsky.actor.getProfiles` (up to 25 per request).

### Step 5: Statistics & Dashboard
Aggregate statistics are computed across all enriched followers, and the dashboard renders with overview cards and a sortable/filterable follower list.

### Rate Limiting
A 200ms delay is inserted between every API request to stay within the public API's limit of ~3,000 requests per 5 minutes per IP.

| Followers | API Calls | Approximate Time |
|---|---|---|
| 100 | ~8 | ~2 seconds |
| 1,000 | ~60 | ~15 seconds |
| 5,000 | ~220 | ~50 seconds |
| 10,000 | ~420 | ~90 seconds |

## Current Features

### Profile Summary Card

- **Banner image** and **avatar** with overlapping layout
- **Display name and @handle**
- **Bio text** with preserved line breaks
- **Follower, following, and post counts** formatted with K/M suffixes
- **Account creation date**

### Dashboard

**Overview Stats** (4 cards):
- **Total Followers** — complete follower count
- **Mutuals** — how many followers you follow back
- **Avg Followers** — average follower count across your followers
- **Avg Posts** — average post count across your followers

**Follower List** (scrollable, sortable, filterable):
- Each follower shows: avatar, display name, @handle, bio snippet, follower/post/following counts
- **Sort** by followers, posts, following count, or name (ascending/descending toggle)
- **Text search** filters across handle, display name, and bio content

## Architecture

```
src/
├── api/
│   └── bluesky.ts            # AT Protocol API service layer
│
├── components/
│   ├── SearchBar.tsx          # Handle input form
│   ├── ProfileSummary.tsx     # Target user's profile card
│   ├── LoadingProgress.tsx    # Analysis progress bar
│   ├── FollowerDashboard.tsx  # Overview stats + follower list
│   └── FollowerList.tsx       # Sortable/filterable follower list
│
├── hooks/
│   └── useFollowerAnalysis.ts # Analysis pipeline orchestrator
│
├── utils/
│   └── stats.ts               # Statistics computation and formatting
│
├── types/
│   └── index.ts               # TypeScript type definitions
│
├── App.tsx                    # Root component
├── main.tsx                   # Entry point
└── index.css                  # Tailwind CSS import
```

## API Reference

| Endpoint | Purpose | Pagination |
|---|---|---|
| `app.bsky.actor.getProfile` | Fetch a user's full profile | N/A |
| `app.bsky.graph.getFollowers` | List accounts that follow a user | Cursor-based, max 100/page |
| `app.bsky.graph.getFollows` | List accounts a user follows | Cursor-based, max 100/page |
| `app.bsky.actor.getProfiles` | Batch-fetch full profiles by DID | Max 25 actors per request |

**Base URL:** `https://public.api.bsky.app/xrpc/`

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Planned Features

- **Follower categorization** — organize followers by activity level, network relationships, and bio-based interests
- **Deep post analysis** — fetch recent posts per follower for last-active date and content topics
- **Engagement analysis** — identify top engagers and silent followers
- **Growth tracking** — store snapshots in localStorage to track follower changes over time
- **Data export** — CSV/JSON export of follower data
- **Comparison mode** — compare two users' follower bases
- **Optional OAuth login** — higher rate limits and viewer-specific data
- **Visualizations** — charts, network graphs, and activity heatmaps
- **Shareable results** — generate summary cards and shareable links

## License

MIT
