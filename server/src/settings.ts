/**
 * Operator-tunable numbers, read from the `settings` table on every use.
 *
 * Quota amounts are in micro-yuan (1 元 = 1,000,000), the same unit the cost
 * accounting uses, so a daily allowance and a measured request cost can be
 * compared without any rounding in between.
 *
 * A missing or unparseable value falls back to the default below: an operator
 * typo must never turn into a quota of zero (which would block everyone) or an
 * unlimited one (which would spend without a ceiling).
 */
import type { GatewayDatabase } from './db.js'

export type QuotaMode = 'off' | 'shadow' | 'enforce'

export interface Settings {
  /** off: no quota logic at all. shadow: measure only, never block. enforce: block. */
  quotaMode: QuotaMode
  /** Free allowance per Beijing day. */
  dailyFreeMicro: number
  /** Quota credited by one completed task. */
  rewardAmountMicro: number
  /** Ceiling on reward credits per Beijing day. */
  dailyRewardCapMicro: number
  /** Shortest believable completion, in seconds from task start. */
  rewardMinSeconds: number
  /** How many tasks one account may complete per Beijing day. */
  rewardDailyLimit: number
  /** Accounts that may see and use rewards; empty means nobody may. */
  rewardAccounts: string[]
  /** Which task provider issues rewards: `fake-ad` today, an ad network later. */
  rewardProvider: string
  /**
   * Per-account daily allowance override, in micro-yuan. The operator's own
   * account needs headroom for testing; an ordinary account gets the default.
   */
  accountAllowances: Map<string, number>
}

const SETTING_DEFAULTS: Record<string, string> = {
  'quota.mode': 'off',
  'quota.dailyFreeMicro': '10000000',
  'quota.rewardAmountMicro': '1000000',
  'quota.dailyRewardCapMicro': '3000000',
  'quota.rewardMinSeconds': '15',
  'quota.rewardDailyLimit': '3',
  'quota.rewardAccounts': '',
  'quota.rewardProvider': 'fake-ad',
  'quota.accountAllowances': '',
}

/** What an operator may set, with the reason it exists. Used by the CLI's help. */
export const SETTING_KEYS: { key: string; meaning: string }[] = [
  { key: 'quota.mode', meaning: 'off | shadow | enforce（shadow 只统计不拦截）' },
  { key: 'quota.dailyFreeMicro', meaning: '每日免费额度，微元（1 元 = 1000000）' },
  { key: 'quota.rewardAmountMicro', meaning: '单次任务入账额度，微元' },
  { key: 'quota.dailyRewardCapMicro', meaning: '每日任务入账上限，微元' },
  { key: 'quota.rewardMinSeconds', meaning: '任务最短完成时长（秒）' },
  { key: 'quota.rewardDailyLimit', meaning: '每日任务次数上限' },
  { key: 'quota.rewardAccounts', meaning: '可用奖励的账号 id，逗号分隔；空=无人可用' },
  { key: 'quota.rewardProvider', meaning: '任务来源：fake-ad（模拟）或将来接入的真实平台' },
  { key: 'quota.accountAllowances', meaning: '按账号覆盖每日额度，格式 账号id:微元，逗号分隔' },
]

export function readRawSettings(db: GatewayDatabase): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return new Map(rows.map((row) => [row.key, row.value]))
}

function wholeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return fallback
  return value
}

/**
 * `账号id:微元` pairs. A malformed pair is dropped rather than defaulting the
 * whole map away, and an unknown account simply never matches.
 */
export function parseAccountAllowances(raw: string | undefined): Map<string, number> {
  const allowances = new Map<string, number>()
  for (const entry of (raw ?? '').split(',')) {
    const [account, micro] = entry.split(':').map((part) => part.trim())
    if (account === undefined || micro === undefined || !/^[\w-]{1,64}$/.test(account)) continue
    const value = wholeNumber(micro, -1)
    if (value < 0) continue
    allowances.set(account, value)
  }
  return allowances
}

export function readSettings(db: GatewayDatabase): Settings {
  const stored = readRawSettings(db)
  const value = (key: string): string | undefined => stored.get(key) ?? SETTING_DEFAULTS[key]
  const mode = value('quota.mode')
  return {
    quotaMode: mode === 'shadow' || mode === 'enforce' ? mode : 'off',
    dailyFreeMicro: wholeNumber(value('quota.dailyFreeMicro'), 10_000_000),
    rewardAmountMicro: wholeNumber(value('quota.rewardAmountMicro'), 1_000_000),
    dailyRewardCapMicro: wholeNumber(value('quota.dailyRewardCapMicro'), 3_000_000),
    rewardMinSeconds: wholeNumber(value('quota.rewardMinSeconds'), 15),
    rewardDailyLimit: wholeNumber(value('quota.rewardDailyLimit'), 3),
    rewardAccounts: (value('quota.rewardAccounts') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
    rewardProvider: (value('quota.rewardProvider') ?? 'fake-ad').trim() || 'fake-ad',
    accountAllowances: parseAccountAllowances(value('quota.accountAllowances')),
  }
}

/** Rejects an unknown key or an unusable value instead of storing it silently. */
function validateSetting(key: string, raw: string): string {
  if (!(key in SETTING_DEFAULTS)) {
    throw new Error(`未知配置项 ${key}；可用：${Object.keys(SETTING_DEFAULTS).join(', ')}`)
  }
  const value = raw.trim()
  if (key === 'quota.mode') {
    if (value !== 'off' && value !== 'shadow' && value !== 'enforce') {
      throw new Error('quota.mode 只能是 off、shadow 或 enforce')
    }
  } else if (key === 'quota.rewardAccounts') {
    const accounts = value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
    for (const account of accounts) {
      if (!/^[\w-]{1,64}$/.test(account)) throw new Error(`账号 id 格式不对：${account}`)
    }
  } else if (key === 'quota.rewardProvider') {
    if (!/^[\w-]{1,32}$/.test(value)) throw new Error(`任务来源标识格式不对：${raw}`)
  } else if (key === 'quota.accountAllowances') {
    for (const entry of value.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
      const [account, micro] = entry.split(':').map((part) => part.trim())
      if (account === undefined || micro === undefined || !/^[\w-]{1,64}$/.test(account)) {
        throw new Error(`格式应为 账号id:微元，收到 ${entry}`)
      }
      if (wholeNumber(micro, -1) < 0) throw new Error(`${entry} 的额度需要是非负整数（微元）`)
    }
  } else if (wholeNumber(value, -1) < 0) {
    throw new Error(`${key} 需要非负整数，收到 ${raw}`)
  }
  return value
}

export function writeSetting(db: GatewayDatabase, key: string, raw: string): void {
  const value = validateSetting(key, raw)
  db.prepare(
    'INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt',
  ).run(key, value, new Date().toISOString())
}
