/**
 * The daily quota: what an account may still spend today, measured in the same
 * unit the accounting uses (micro-yuan), so "remaining" is real money rather
 * than a request count.
 *
 * The spent side is not a counter we maintain — it is recomputed from the usage
 * rows the gateway already stores, priced with the official price table. That
 * keeps one source of truth for money and means a pricing correction also
 * corrects the quota.
 */
import type { GatewayDatabase } from './db.js'
import { startOfDay, dayStamp } from './clock.js'
import { costOf } from './pricing.js'
import type { Settings } from './settings.js'

export interface QuotaState {
  /** Free allowance plus everything credited today. */
  limitMicro: number
  spentMicro: number
  /** Negative is possible: the last request is allowed to overrun the quota. */
  remainingMicro: number
  exhausted: boolean
  /** Next 00:00 Beijing, when the day (and the allowance) resets. */
  resetAt: string
  /** Whether this account is meant to see the meter at all. */
  visible: boolean
}

/**
 * Real cost of the account's model calls since an instant. Rows whose usage the
 * provider did not report are skipped: an unknown cost must not be charged as
 * zero silently, and it must not block anyone either.
 */
export function spentMicroSince(db: GatewayDatabase, accountId: string, sinceIso: string): number {
  const rows = db
    .prepare(
      `SELECT ts, model, inputTokens, cacheHitTokens, cacheMissTokens, outputTokens
       FROM usage WHERE userId = ? AND ts >= ? AND inputTokens IS NOT NULL`,
    )
    .all(accountId, sinceIso) as {
    ts: string
    model: string | null
    inputTokens: number
    cacheHitTokens: number | null
    cacheMissTokens: number | null
    outputTokens: number | null
  }[]

  let total = 0
  for (const row of rows) {
    const cost = costOf(
      {
        inputTokens: row.inputTokens,
        cacheHitTokens: row.cacheHitTokens ?? 0,
        cacheMissTokens: row.cacheMissTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        reasoningTokens: 0,
      },
      row.model,
      new Date(row.ts),
    )
    if (cost !== undefined) total += cost
  }
  return Math.round(total * 1_000_000)
}

/** Quota credited by completed tasks today. */
export function grantedMicroToday(db: GatewayDatabase, accountId: string, now = new Date()): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amountMicro), 0) AS granted FROM reward_grants WHERE accountId = ? AND day = ?')
    .get(accountId, dayStamp(now)) as { granted: number }
  return row.granted
}

/** The next 00:00 Beijing as an instant. China has no daylight saving. */
export function nextResetAt(now = new Date()): string {
  return new Date(Date.parse(startOfDay(now)) + 24 * 3600 * 1000).toISOString()
}

/**
 * Whether this account should see the meter. In `enforce` every account does;
 * in `shadow` only the allowlist does, so an unreleased mechanism stays
 * invisible to ordinary users while it is being measured.
 */
export function quotaVisible(settings: Settings, accountId: string): boolean {
  if (settings.quotaMode === 'off') return false
  return settings.quotaMode === 'enforce' || settings.rewardAccounts.includes(accountId)
}

export function quotaState(
  db: GatewayDatabase,
  accountId: string,
  settings: Settings,
  now = new Date(),
): QuotaState {
  const spentMicro = spentMicroSince(db, accountId, startOfDay(now))
  const limitMicro = settings.dailyFreeMicro + grantedMicroToday(db, accountId, now)
  const remainingMicro = limitMicro - spentMicro
  return {
    limitMicro,
    spentMicro,
    remainingMicro,
    // Blocked only once the quota is used up: a request that starts with quota
    // left is allowed to overrun it, so the boundary is not a cliff the user
    // cannot see coming.
    exhausted: remainingMicro <= 0,
    resetAt: nextResetAt(now),
    visible: quotaVisible(settings, accountId),
  }
}
