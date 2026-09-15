/**
 * The one place money is calculated.
 *
 * Prices are the official DeepSeek CNY list price per 1M tokens, taken from
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing (read 2026-09-15):
 *
 *   deepseek-flash        cache hit ¥0.02 | cache miss ¥1   | output ¥4
 *   deepseek-v4-pro       cache hit ¥0.15 | cache miss ¥4.5 | output ¥13.5
 *
 * Off-peak prices are half of peak. Peak hours are Beijing time 09:00-12:00 and
 * 14:00-18:00, Monday to Friday, which is 01:00-04:00 and 06:00-10:00 UTC.
 *
 * `deepseek-v4-flash` is the legacy name for deepseek-flash: the model was
 * retired, requests are served by DeepSeek-V4.1-Flash and billed at Flash
 * prices, so both names map to the same row.
 *
 * Byte counts must never be used to price anything — a streaming response is one
 * JSON frame per token, so response bytes overstate tokens by roughly 300x.
 */

export interface ModelPrice {
  /** CNY per 1M input tokens served from cache. */
  cacheHit: number
  /** CNY per 1M input tokens not served from cache. */
  cacheMiss: number
  /** CNY per 1M output tokens (reasoning tokens are billed here). */
  output: number
}

const OFF_PEAK_PRICES: Record<string, ModelPrice> = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

/** Peak windows in UTC: Beijing 09:00-12:00 and 14:00-18:00, Mon-Fri. */
export function isPeakHour(at: Date): boolean {
  const weekday = at.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** Price for a model at a moment, or undefined for a model we have no price for. */
export function priceFor(model: string | null | undefined, at: Date): ModelPrice | undefined {
  if (model === null || model === undefined) return undefined
  const base = OFF_PEAK_PRICES[model]
  if (base === undefined) return undefined
  if (!isPeakHour(at)) return base
  return { cacheHit: base.cacheHit * 2, cacheMiss: base.cacheMiss * 2, output: base.output * 2 }
}

export interface TokenUsage {
  /** Prompt tokens, i.e. cacheHit + cacheMiss. */
  inputTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  outputTokens: number
  reasoningTokens: number
}

/** CNY for one request, or undefined when the model has no known price. */
export function costOf(usage: TokenUsage, model: string | null | undefined, at: Date): number | undefined {
  const price = priceFor(model, at)
  if (price === undefined) return undefined
  return (
    (usage.cacheHitTokens / 1e6) * price.cacheHit +
    (usage.cacheMissTokens / 1e6) * price.cacheMiss +
    (usage.outputTokens / 1e6) * price.output
  )
}

/** Share of input tokens served from cache, or undefined without input tokens. */
export function cacheHitRate(usage: TokenUsage): number | undefined {
  if (usage.inputTokens <= 0) return undefined
  return usage.cacheHitTokens / usage.inputTokens
}

export function knownModels(): string[] {
  return Object.keys(OFF_PEAK_PRICES)
}
