import type { GatewayDatabase } from './db.js'
import type { TokenUsage } from './pricing.js'

export interface UsageRecord {
  userId: string
  model: string | null
  promptChars: number
  completionChars: number
  status: number
  latencyMs: number
  /** Tokens exactly as the provider reported them; absent when it reported none. */
  tokens?: TokenUsage
  /** The harness session the request belongs to, when the client sent one. */
  sessionId?: string | null
  /** 'provider' when the usage block was captured, 'missing' when it was not. */
  usageSource?: 'provider' | 'missing'
  /** 'title' for the session-title call, 'chat' for everything else. */
  requestKind?: 'chat' | 'title'
}

export function recordUsage(db: GatewayDatabase, record: UsageRecord): void {
  const tokens = record.tokens
  db.prepare(
    `INSERT INTO usage (
       userId, ts, model, promptChars, completionChars, status, latencyMs,
       inputTokens, cacheHitTokens, cacheMissTokens, outputTokens, reasoningTokens,
       sessionId, usageSource, requestKind
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.userId,
    new Date().toISOString(),
    record.model,
    record.promptChars,
    record.completionChars,
    record.status,
    record.latencyMs,
    tokens?.inputTokens ?? null,
    tokens?.cacheHitTokens ?? null,
    tokens?.cacheMissTokens ?? null,
    tokens?.outputTokens ?? null,
    tokens?.reasoningTokens ?? null,
    record.sessionId ?? null,
    record.usageSource ?? (tokens === undefined ? null : 'provider'),
    record.requestKind ?? 'chat',
  )
}

export function countRequestsSince(db: GatewayDatabase, userId: string, sinceIso: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM usage WHERE userId = ? AND ts >= ?')
    .get(userId, sinceIso) as { n: number }
  return row.n
}
