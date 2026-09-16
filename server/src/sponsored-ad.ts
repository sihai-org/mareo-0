import { readFile } from 'node:fs/promises'
import type { GatewayDatabase } from './db.js'

export interface SponsoredAd {
  id: string
  image: string
  title: string
  description: string
  targetUrl: string
  advertiser: string
}

/** A missing, disabled or invalid manual configuration means no ad. */
export async function readSponsoredAd(file: string): Promise<SponsoredAd | null> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    if (!raw || raw.enabled !== true || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id)) return null
    for (const [field, max] of [['title', 120], ['description', 300], ['advertiser', 80]] as const) {
      if (typeof raw[field] !== 'string' || !raw[field].trim() || raw[field].length > max) return null
    }
    for (const field of ['image', 'targetUrl'] as const) {
      if (typeof raw[field] !== 'string' || raw[field].length > 2048) return null
      const url = new URL(raw[field])
      if (url.protocol !== 'https:' || url.username || url.password) return null
    }
    return { id: raw.id, image: raw.image, title: raw.title, description: raw.description,
      targetUrl: raw.targetUrl, advertiser: raw.advertiser }
  } catch {
    return null
  }
}

export function recordAdEvent(db: GatewayDatabase, userId: string, raw: unknown, ad: SponsoredAd | null): number {
  if (!raw || typeof raw !== 'object') return 400
  const event = raw as Record<string, unknown>
  if (typeof event.eventId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(event.eventId) ||
      typeof event.adId !== 'string' || event.placement !== 'sidebar-footer' ||
      (event.type !== 'impression' && event.type !== 'click')) return 400

  const previous = db.prepare('SELECT userId, adId, placement, type FROM ad_events WHERE eventId = ?').get(event.eventId)
  if (previous) {
    return previous.userId === userId && previous.adId === event.adId &&
      previous.placement === event.placement && previous.type === event.type ? 200 : 409
  }
  // Old creative IDs are rejected after a configuration switch, not silently
  // credited to the new advertiser. No arbitrary client-supplied IDs are stored.
  if (!ad || event.adId !== ad.id) return 400
  const now = Date.now()
  const recent = db.prepare('SELECT COUNT(*) AS n FROM ad_events WHERE userId = ? AND createdAt >= ?')
    .get(userId, new Date(now - 60_000).toISOString()) as { n: number }
  if (recent.n >= 30) return 429
  db.prepare('DELETE FROM ad_events WHERE createdAt < ?').run(new Date(now - 180 * 86_400_000).toISOString())
  db.prepare('INSERT INTO ad_events (eventId, adId, placement, userId, type, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(event.eventId, event.adId, event.placement, userId, event.type, new Date(now).toISOString())
  return 200
}
