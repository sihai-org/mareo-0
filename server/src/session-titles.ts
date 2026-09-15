import type { GatewayDatabase } from './db.js'

/**
 * Session labels. One row per会话, keyed by account + session, so a refreshed
 * title simply replaces the old one. Nothing else about the conversation is kept.
 */
export function recordSessionTitle(
  db: GatewayDatabase,
  accountId: string | null,
  sessionId: string | null,
  title: string,
  source: 'gateway' | 'client',
): boolean {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (accountId === null || trimmed === '') return false
  // The title call does not always carry a session header. The label is still
  // worth keeping — it answers "what is this account working on" — so it is
  // stored under a synthetic key until the client reports the exact session.
  const key = sessionId ?? `unattributed:${new Date().toISOString()}`
  db.prepare(
    `INSERT INTO session_titles (accountId, sessionId, title, source, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (accountId, sessionId) DO UPDATE SET title = excluded.title, source = excluded.source, updatedAt = excluded.updatedAt`,
  ).run(accountId, key, trimmed, source, new Date().toISOString())
  return true
}

/** Extracts { sessionId, title } from a client-reported session_title event. */
export function parseSessionTitleDetail(detail: string | undefined): { sessionId: string; title: string } | undefined {
  if (detail === undefined) return undefined
  try {
    const parsed = JSON.parse(detail) as { sessionId?: unknown; title?: unknown }
    if (typeof parsed.sessionId !== 'string' || typeof parsed.title !== 'string') return undefined
    if (parsed.sessionId === '' || parsed.title.trim() === '') return undefined
    return { sessionId: parsed.sessionId.slice(0, 128), title: parsed.title }
  } catch {
    return undefined
  }
}
