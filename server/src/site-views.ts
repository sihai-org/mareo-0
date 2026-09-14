import type { GatewayDatabase } from './db.js'

/**
 * Website page views. The website sends one beacon per page load and only for
 * these paths, so nothing a visitor does beyond "opened this page" is recorded.
 */
export const COUNTED_PATHS = ['/', '/privacy.html'] as const

/** Accepts the beacon payload and normalises the path, or rejects it. */
export function parseSiteView(payload: unknown): { path: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const raw = (payload as { path?: unknown }).path
  if (typeof raw !== 'string') return undefined
  const path = raw.split('?')[0].split('#')[0]
  const normalised = path === '/index.html' || path === '' ? '/' : path
  return (COUNTED_PATHS as readonly string[]).includes(normalised) ? { path: normalised } : undefined
}

/** Local calendar day, in the operator's timezone (the server runs in CST). */
export function dayStamp(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function recordSiteView(db: GatewayDatabase, path: string, now = new Date()): void {
  db.prepare(
    `INSERT INTO site_views (day, path, count) VALUES (?, ?, 1)
     ON CONFLICT (day, path) DO UPDATE SET count = count + 1`,
  ).run(dayStamp(now), path)
}

export interface SiteViewTotal {
  total: number
  byPath: { path: string; count: number }[]
}

/** Page views since a given day (inclusive), newest day first for the page. */
export function siteViewsSince(db: GatewayDatabase, sinceDay: string): SiteViewTotal {
  const rows = db
    .prepare('SELECT path, SUM(count) AS count FROM site_views WHERE day >= ? GROUP BY path ORDER BY count DESC')
    .all(sinceDay) as { path: string; count: number }[]
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byPath: rows.map((row) => ({ path: row.path, count: row.count })),
  }
}
