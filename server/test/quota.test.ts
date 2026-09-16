// The daily quota is money, so these tests pin down the arithmetic: what counts
// as spent, when the day turns over, and who may see or use the meter.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createTokenAccount, openDatabase, type GatewayDatabase } from '../src/db.js'
import { recordUsage } from '../src/usage.js'
import { costOf, type TokenUsage } from '../src/pricing.js'
import { dailyFreeMicroFor, grantedMicroToday, quotaState, quotaVisible, spentMicroSince } from '../src/quota.js'
import { creditReward } from '../src/rewards.js'
import { parseAccountAllowances, readSettings, writeSetting } from '../src/settings.js'
import { dayStamp, startOfDay } from '../src/clock.js'
import { quotaImpact, type Row } from '../src/cost-report.js'

const directory = mkdtempSync(path.join(tmpdir(), 'mareo-quota-'))
const db: GatewayDatabase = openDatabase(path.join(directory, 'quota.db'))

test.after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

let accounts = 0
function newAccount(): string {
  accounts += 1
  return createTokenAccount(db, `额度测试${accounts}`)
}

const sample: TokenUsage = { inputTokens: 1_000_000, cacheHitTokens: 1_000_000, cacheMissTokens: 0, outputTokens: 0, reasoningTokens: 0 }

/** A usage row as the proxy stores it, priced the way the quota prices it. */
function addUsage(userId: string, tokens: TokenUsage, when?: string, model = 'deepseek-flash'): number {
  recordUsage(db, {
    userId,
    model,
    promptChars: 0,
    completionChars: 0,
    status: 200,
    latencyMs: 0,
    tokens,
    usageSource: 'provider',
  })
  if (when !== undefined) {
    const id = (db.prepare('SELECT MAX(id) AS id FROM usage').get() as { id: number }).id
    db.prepare('UPDATE usage SET ts = ? WHERE id = ?').run(when, id)
  }
  return Math.round((costOf(tokens, model, new Date(when ?? new Date().toISOString())) ?? 0) * 1_000_000)
}

function settingsFor(overrides: Partial<ReturnType<typeof readSettings>> = {}): ReturnType<typeof readSettings> {
  return { ...readSettings(db), quotaMode: 'enforce', dailyFreeMicro: 10_000_000, ...overrides }
}

test('spent today is the real cost of today\'s priced requests, and only that', () => {
  const account = newAccount()
  assert.equal(spentMicroSince(db, account, startOfDay()), 0)
  const first = addUsage(account, sample)
  assert.ok(first > 0, 'the sample request must cost something')
  assert.equal(spentMicroSince(db, account, startOfDay()), first)
  const second = addUsage(account, sample)
  assert.equal(spentMicroSince(db, account, startOfDay()), first + second)

  // A request whose usage the provider never reported has no known cost: it must
  // not be charged as zero, and it must not block anything either.
  recordUsage(db, {
    userId: account, model: 'deepseek-flash', promptChars: 0, completionChars: 0,
    status: 200, latencyMs: 0, usageSource: 'missing',
  })
  assert.equal(spentMicroSince(db, account, startOfDay()), first + second)

  // A model with no price row cannot be charged either.
  recordUsage(db, {
    userId: account, model: 'deepseek-unknown', promptChars: 0, completionChars: 0,
    status: 200, latencyMs: 0, tokens: sample, usageSource: 'provider',
  })
  assert.equal(spentMicroSince(db, account, startOfDay()), first + second)
})

test('yesterday\'s requests and rewards do not touch today', () => {
  const account = newAccount()
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
  addUsage(account, sample, yesterday.toISOString())
  creditReward(db, account, 'fake-ad', 'yesterday-task', 5_000_000, yesterday)
  assert.equal(spentMicroSince(db, account, startOfDay()), 0)
  assert.equal(grantedMicroToday(db, account), 0)
  const state = quotaState(db, account, settingsFor({ dailyFreeMicro: 1_000_000 }))
  assert.equal(state.limitMicro, 1_000_000)
  assert.equal(state.spentMicro, 0)
})

test('rewards extend today\'s allowance', () => {
  const account = newAccount()
  assert.equal(quotaState(db, account, settingsFor()).limitMicro, 10_000_000)
  creditReward(db, account, 'fake-ad', 'today-task', 1_000_000)
  assert.equal(quotaState(db, account, settingsFor()).limitMicro, 11_000_000)
  assert.equal(quotaState(db, account, settingsFor()).remainingMicro, 11_000_000)
})

test('the last request may overrun the quota; from then on the account is blocked', () => {
  const account = newAccount()
  const spent = addUsage(account, sample)
  // One micro-yuan left: still allowed, because the request begins with quota.
  assert.equal(quotaState(db, account, settingsFor({ dailyFreeMicro: spent + 1 })).exhausted, false)
  const over = quotaState(db, account, settingsFor({ dailyFreeMicro: spent - 1 }))
  assert.equal(over.exhausted, true)
  assert.ok(over.remainingMicro < 0, 'the overrun is carried, not clamped to zero')
  assert.equal(quotaState(db, account, settingsFor({ dailyFreeMicro: 0 })).exhausted, true)
})

test('a reversal subtracts, and the same provider id can only land once', () => {
  const account = newAccount()
  creditReward(db, account, 'fake-ad', 'commission', 2_000_000)
  assert.equal(quotaState(db, account, settingsFor()).limitMicro, 12_000_000)
  assert.equal(creditReward(db, account, 'fake-ad', 'commission', 2_000_000), false)
  assert.equal(quotaState(db, account, settingsFor()).limitMicro, 12_000_000)
  assert.equal(creditReward(db, account, 'fake-ad', 'commission-refund', -2_000_000), true)
  assert.equal(quotaState(db, account, settingsFor()).limitMicro, 10_000_000)
})

test('a new Beijing day resets the allowance to the free amount', () => {
  const account = newAccount()
  // A day that has just turned over: a row from a minute ago belongs to the
  // previous Beijing day only if it is before 00:00 Beijing, so anchor on the
  // boundary itself.
  const justBeforeMidnight = new Date(Date.parse(startOfDay()) - 60_000).toISOString()
  addUsage(account, sample, justBeforeMidnight)
  assert.equal(spentMicroSince(db, account, startOfDay()), 0)
  assert.equal(quotaState(db, account, settingsFor()).remainingMicro, 10_000_000)
})

test('off hides the meter from everyone; shadow only from the allowlist; enforce from nobody', () => {
  const account = newAccount()
  const other = newAccount()
  const base = readSettings(db)
  assert.equal(quotaVisible({ ...base, quotaMode: 'off', rewardAccounts: [account] }, account), false)
  assert.equal(quotaVisible({ ...base, quotaMode: 'shadow', rewardAccounts: [] }, account), false)
  assert.equal(quotaVisible({ ...base, quotaMode: 'shadow', rewardAccounts: [account] }, account), true)
  assert.equal(quotaVisible({ ...base, quotaMode: 'shadow', rewardAccounts: [other] }, account), false)
  assert.equal(quotaVisible({ ...base, quotaMode: 'enforce', rewardAccounts: [] }, account), true)
  assert.equal(quotaVisible({ ...base, quotaMode: 'enforce', rewardAccounts: [other] }, account), true)
})

test('a broken setting falls back to the default instead of to zero', () => {
  writeSetting(db, 'quota.dailyFreeMicro', '2500000')
  assert.equal(readSettings(db).dailyFreeMicro, 2_500_000)
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES ('quota.dailyFreeMicro', 'not-a-number', 'x')").run()
  // Zero would block every account; the default is the safe direction.
  assert.equal(readSettings(db).dailyFreeMicro, 10_000_000)
  db.prepare("DELETE FROM settings WHERE key = 'quota.dailyFreeMicro'").run()
  assert.equal(readSettings(db).dailyFreeMicro, 10_000_000)
  assert.throws(() => writeSetting(db, 'quota.mode', 'sometimes'), /off/)
  assert.throws(() => writeSetting(db, 'quota.unknown', '1'), /未知配置项/)
})

test('one account can be given a different allowance than everyone else', () => {
  const account = newAccount()
  const other = newAccount()
  const settings = settingsFor({ accountAllowances: new Map([[account, 100_000_000]]) })
  assert.equal(dailyFreeMicroFor(settings, account), 100_000_000)
  assert.equal(dailyFreeMicroFor(settings, other), settings.dailyFreeMicro)
  assert.equal(quotaState(db, account, settings).limitMicro, 100_000_000)
  assert.equal(quotaState(db, other, settings).limitMicro, settings.dailyFreeMicro)

  // A malformed pair is dropped, never turned into a zero allowance.
  assert.deepEqual([...parseAccountAllowances('abc:5, no-colon, , xyz:notanumber, def:25')], [
    ['abc', 5],
    ['def', 25],
  ])
  assert.equal(parseAccountAllowances(undefined).size, 0)
  assert.throws(() => writeSetting(db, 'quota.accountAllowances', 'no-colon'), /账号id:微元/)
})

test('shadow analysis counts the accounts and requests a threshold would stop', () => {
  const account = newAccount()
  const day = dayStamp()
  const first = addUsage(account, sample)
  const second = addUsage(account, sample)
  const third = addUsage(account, sample)
  const rows = db
    .prepare(
      `SELECT userId, ts, model, status, inputTokens, cacheHitTokens, cacheMissTokens,
              outputTokens, reasoningTokens, sessionId, usageSource
       FROM usage WHERE userId = ? ORDER BY id`,
    )
    .all(account) as unknown as Row[]

  // The line falls inside the second request: it is allowed to overrun (it began
  // with quota left), and the third is the first one the user cannot make.
  const tight = quotaImpact(rows, day, first + second / 2)
  assert.equal(tight.accounts, 1)
  assert.equal(tight.requests, 3)
  assert.equal(tight.blockedAccounts, 1)
  assert.equal(tight.blockedRequests, 1)
  assert.equal(tight.costBeyondMicro, third)

  const generous = quotaImpact(rows, day, (first + second + third) * 100)
  assert.equal(generous.blockedAccounts, 0)
  assert.equal(generous.blockedRequests, 0)
  assert.equal(generous.costBeyondMicro, 0)
})
