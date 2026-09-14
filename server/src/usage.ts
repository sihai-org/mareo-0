import type { GatewayDatabase } from './db.js'

export interface UsageRecord {
  userId: string
  model: string | null
  promptChars: number
  completionChars: number
  status: number
  latencyMs: number
}

export function recordUsage(db: GatewayDatabase, record: UsageRecord): void {
  db.prepare(
    `INSERT INTO usage (userId, ts, model, promptChars, completionChars, status, latencyMs)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.userId,
    new Date().toISOString(),
    record.model,
    record.promptChars,
    record.completionChars,
    record.status,
    record.latencyMs,
  )
}

export function countRequestsSince(db: GatewayDatabase, userId: string, sinceIso: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM usage WHERE userId = ? AND ts >= ?')
    .get(userId, sinceIso) as { n: number }
  return row.n
}
