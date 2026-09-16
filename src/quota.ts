/**
 * The gateway's quota meter, fetched in the main process (which holds the
 * token) and handed to the UI as plain numbers.
 *
 * The UI shows a percentage, never an amount: what the user needs to know is
 * "how much of today is left", not what their reading costs us.
 */
export interface QuotaMeter {
  limitMicro: number
  spentMicro: number
  remainingMicro: number
  usedPercent: number
  exhausted: boolean
  /** Next 00:00 Beijing, when the allowance resets. */
  resetAt: string
  /** False when the gateway is not running a quota, or not for this account. */
  visible: boolean
}

export interface QuotaSnapshot {
  quota: QuotaMeter
}

const REQUEST_TIMEOUT_MS = 5_000

export class QuotaClient {
  private cached: { at: number; value: QuotaSnapshot | null } | undefined

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** One fetch per `maxAgeMs`: several UI surfaces ask, the gateway is asked once. */
  async load(maxAgeMs = 10_000): Promise<QuotaSnapshot | null> {
    const now = Date.now()
    if (this.cached !== undefined && now - this.cached.at < maxAgeMs) return this.cached.value
    const value = await this.get('/quota')
    this.cached = { at: now, value }
    return value
  }

  private async get(path: string): Promise<QuotaSnapshot | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      })
      if (!response.ok) return null
      return readSnapshot(await response.json())
    } catch {
      return null
    }
  }
}

/** Anything the UI will render is checked first; the gateway is ours but the shape still matters. */
export function readSnapshot(raw: unknown): QuotaSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const quota = (raw as { quota?: unknown }).quota
  if (quota === null || typeof quota !== 'object') return null
  const meter = quota as Record<string, unknown>
  const numbers = ['limitMicro', 'spentMicro', 'remainingMicro', 'usedPercent'] as const
  for (const field of numbers) {
    if (typeof meter[field] !== 'number' || !Number.isFinite(meter[field])) return null
  }
  if (typeof meter.exhausted !== 'boolean' || typeof meter.visible !== 'boolean') return null
  if (typeof meter.resetAt !== 'string') return null
  return {
    quota: {
      limitMicro: meter.limitMicro as number,
      spentMicro: meter.spentMicro as number,
      remainingMicro: meter.remainingMicro as number,
      usedPercent: Math.min(100, Math.max(0, meter.usedPercent as number)),
      exhausted: meter.exhausted,
      resetAt: meter.resetAt,
      visible: meter.visible,
    },
  }
}
