import type { GatewayDatabase } from './db.js'

/**
 * Client-reported events. The set of names is closed on purpose: anything else
 * is dropped rather than stored, so the table can only ever hold these four
 * shapes of operational data.
 */
export const CLIENT_EVENT_NAMES = ['install_confirmed', 'launch', 'harness_exit', 'signin'] as const

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number]

export interface ClientEvent {
  name: ClientEventName
  version?: string
  platform?: string
  /** Short, content-free context (the client sends compact JSON); stored as text. */
  detail?: string
}

const MAX_EVENTS_PER_REQUEST = 20
const MAX_DETAIL_LENGTH = 4_000

/** Keeps anything unusable out; undefined means the request carried no valid event. */
export function parseEvents(payload: unknown): ClientEvent[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const events = (payload as { events?: unknown }).events
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS_PER_REQUEST) return undefined

  const parsed: ClientEvent[] = []
  for (const entry of events) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = record.name
    if (typeof name !== 'string' || !CLIENT_EVENT_NAMES.includes(name as ClientEventName)) continue
    const event: ClientEvent = { name: name as ClientEventName }
    if (typeof record.version === 'string') event.version = record.version.slice(0, 32)
    if (typeof record.platform === 'string') event.platform = record.platform.slice(0, 16)
    if (typeof record.detail === 'string') event.detail = record.detail.slice(0, MAX_DETAIL_LENGTH)
    parsed.push(event)
  }
  return parsed.length > 0 ? parsed : undefined
}

export function recordEvents(db: GatewayDatabase, accountId: string | null, events: ClientEvent[]): void {
  const insert = db.prepare(
    'INSERT INTO events (accountId, name, version, platform, ts, detail) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const ts = new Date().toISOString()
  for (const event of events) {
    insert.run(accountId, event.name, event.version ?? null, event.platform ?? null, ts, event.detail ?? null)
  }
}

/**
 * A client that has not signed in yet cannot identify itself, so its sign-in
 * failures arrive anonymously — that is the point, but it also means the
 * endpoint is open. Cap anonymous events per client address so it cannot be used
 * to flood the table; signed-in events are already tied to an account.
 */
export function createAnonymousEventLimiter(limit = 60, windowMs = 3_600_000) {
  const windows = new Map<string, { count: number; windowStart: number }>()
  return (address: string, now = Date.now()): boolean => {
    if (windows.size > 1_000) {
      for (const [key, window] of windows) {
        if (now - window.windowStart >= windowMs) windows.delete(key)
      }
    }
    const window = windows.get(address)
    if (window === undefined || now - window.windowStart >= windowMs) {
      windows.set(address, { count: 1, windowStart: now })
      return true
    }
    if (window.count >= limit) return false
    window.count += 1
    return true
  }
}
