/**
 * Debug logger — writes structured JSON lines to debug.log via the dev server.
 * Only active in dev mode (import.meta.env.DEV). No-ops in production builds.
 * The debug.log file is gitignored (matched by *.log).
 */

let sessionStart = 0

export function debugLog(label: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return

  if (!sessionStart) sessionStart = Date.now()

  const entry = {
    t: ((Date.now() - sessionStart) / 1000).toFixed(1) + 's',
    label,
    ...data,
  }

  fetch('/api/debug-log', {
    method: 'POST',
    body: JSON.stringify(entry),
  }).catch(() => {})
}
