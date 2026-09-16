import { randomUUID } from 'node:crypto'

export interface SponsoredAd {
  id: string
  image: string
  title: string
  description: string
  targetUrl: string
  advertiser: string
}

/** Validate remote content before it reaches either the renderer or the OS. */
export function parseSponsoredAd(raw: unknown): SponsoredAd | null {
  if (!raw || typeof raw !== 'object') return null
  const ad = raw as Record<string, unknown>
  if (typeof ad.id !== 'string' || !/^[\w-]{1,80}$/.test(ad.id)) return null
  for (const [field, max] of [['title', 120], ['description', 300], ['advertiser', 80]] as const) {
    if (typeof ad[field] !== 'string' || !ad[field].trim() || ad[field].length > max) return null
  }
  try {
    for (const field of ['image', 'targetUrl'] as const) {
      if (typeof ad[field] !== 'string' || ad[field].length > 2048) return null
      const url = new URL(ad[field])
      if (url.protocol !== 'https:' || url.username || url.password) return null
    }
  } catch { return null }
  return { id: ad.id, image: ad.image as string, title: ad.title as string,
    description: ad.description as string, targetUrl: ad.targetUrl as string, advertiser: ad.advertiser as string }
}

/** One document's ad, independent of diagnostic telemetry and model traffic. */
export class SponsoredAdClient {
  private loading?: Promise<SponsoredAd | null>
  private ad: SponsoredAd | null = null
  private impressed = false

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  load(): Promise<SponsoredAd | null> {
    this.loading ??= this.fetchAd()
    return this.loading
  }

  private async fetchAd(): Promise<SponsoredAd | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/sponsored-ad`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(5_000), redirect: 'error',
      })
      if (!response.ok) return null
      const body = await response.json() as { ad?: unknown } | null
      this.ad = parseSponsoredAd(body?.ad)
      return this.ad
    } catch { return null }
  }

  impression(adId: unknown): void {
    if (!this.ad || adId !== this.ad.id || this.impressed) return
    this.impressed = true
    void this.report('impression')
  }

  async click(adId: unknown): Promise<boolean> {
    if (!this.ad || adId !== this.ad.id) return false
    // A failed analytics request must not delay or prevent the browser opening.
    void this.report('click')
    try {
      await this.openExternal(this.ad.targetUrl)
      return true
    } catch { return false }
  }

  private async report(type: 'impression' | 'click'): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/sponsored-ad/events`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: randomUUID(), adId: this.ad!.id, placement: 'sidebar-footer', type }),
        signal: AbortSignal.timeout(5_000), redirect: 'error',
      })
    } catch { /* Best effort, no persistent tracking queue or background retry. */ }
  }
}
