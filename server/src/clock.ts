/**
 * Mareo's day boundary. The operator and every user are in China, so "today",
 * the daily request cap and the page-view counters all turn over at 00:00
 * Beijing time — not at UTC midnight (08:00 Beijing, which nobody expects).
 *
 * China Standard Time is a fixed UTC+8 offset with no daylight saving, so the
 * arithmetic is a plain shift and does not depend on the container's TZ.
 */
export const CHINA_OFFSET_MS = 8 * 3600 * 1000

function shifted(now: Date): Date {
  return new Date(now.getTime() + CHINA_OFFSET_MS)
}

/** ISO instant of the most recent 00:00 Beijing time. */
export function startOfDay(now = new Date()): string {
  const local = shifted(now)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - CHINA_OFFSET_MS).toISOString()
}

/** Calendar day in Beijing time, as `YYYY-MM-DD`. */
export function dayStamp(now = new Date()): string {
  const local = shifted(now)
  const month = String(local.getUTCMonth() + 1).padStart(2, '0')
  const day = String(local.getUTCDate()).padStart(2, '0')
  return `${local.getUTCFullYear()}-${month}-${day}`
}

/** The Beijing calendar day `days` days before `now`, as `YYYY-MM-DD`. */
export function dayStampDaysAgo(days: number, now = new Date()): string {
  return dayStamp(new Date(now.getTime() - days * 24 * 3600 * 1000))
}

/**
 * Start of the Beijing calendar day `days` before `now`. A 7-day window is today
 * plus the previous six days, so `startOfDayDaysAgo(6)`.
 */
export function startOfDayDaysAgo(days: number, now = new Date()): string {
  return startOfDay(new Date(now.getTime() - days * 24 * 3600 * 1000))
}
