import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createTokenAccount, openDatabase, type GatewayDatabase } from '../src/db.js'
import { isTitleRequest, textFromResponseTail, usageFromResponseText } from '../src/proxy.js'
import { cacheHitRate, costOf, isPeakHour, knownModels, priceFor } from '../src/pricing.js'
import { recordUsage } from '../src/usage.js'
import { categoryBreakdown, dayOf, loadSessionTitles, parseBillArguments, perSessionCost, perUserCost, percentile, summarizeDays, tokensOf } from '../src/cost-report.js'
import { classifyTitle } from '../src/session-labels.js'
import { parseSessionTitleDetail, recordSessionTitle } from '../src/session-titles.js'

let directory: string
let db: GatewayDatabase

before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-cost-'))
  db = openDatabase(path.join(directory, 'gateway.db'))
})

after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

/** A streaming response tail, in the shape the provider actually sends. */
function streamingTail(usage: Record<string, unknown>): string {
  return [
    'data: {"id":"1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}',
    '',
    'data: {"id":"1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    '',
    `data: {"id":"1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[],"usage":${JSON.stringify(usage)}}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')
}

const SAMPLE_USAGE = {
  prompt_tokens: 120_000,
  completion_tokens: 2_800,
  total_tokens: 122_800,
  prompt_cache_hit_tokens: 118_000,
  prompt_cache_miss_tokens: 2_000,
  completion_tokens_details: { reasoning_tokens: 1_900 },
}

test('reads the token block the provider sends on every streaming response', () => {
  assert.deepEqual(usageFromResponseText(streamingTail(SAMPLE_USAGE)), {
    inputTokens: 120_000,
    cacheHitTokens: 118_000,
    cacheMissTokens: 2_000,
    outputTokens: 2_800,
    reasoningTokens: 1_900,
  })
})

test('reads a non-streaming JSON body and the older cached_tokens shape', () => {
  const body = JSON.stringify({
    id: '1',
    choices: [{ message: { content: 'hi' } }],
    usage: { prompt_tokens: 500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 400 } },
  })
  assert.deepEqual(usageFromResponseText(body), {
    inputTokens: 500,
    cacheHitTokens: 400,
    cacheMissTokens: 100,
    outputTokens: 20,
    reasoningTokens: 0,
  })
})

test('a response without usage is undefined, never zero', () => {
  // A truncated stream (client aborted) must not be mistaken for a free request.
  assert.equal(usageFromResponseText('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'), undefined)
  assert.equal(usageFromResponseText(''), undefined)
  assert.equal(usageFromResponseText('data: {"usage":'), undefined)
  assert.equal(usageFromResponseText('data: {"usage":{"prompt_tokens":0,"completion_tokens":0}}'), undefined)
})

test('prices follow the published table and halve off peak', () => {
  const offPeak = new Date('2026-09-15T12:00:00Z') // 20:00 Beijing, Tuesday
  const peak = new Date('2026-09-15T02:00:00Z') // 10:00 Beijing, Tuesday
  assert.equal(isPeakHour(offPeak), false)
  assert.equal(isPeakHour(peak), true)
  assert.deepEqual(priceFor('deepseek-v4-flash', offPeak), { cacheHit: 0.02, cacheMiss: 1, output: 4 })
  assert.deepEqual(priceFor('deepseek-v4-flash', peak), { cacheHit: 0.04, cacheMiss: 2, output: 8 })
  assert.equal(priceFor('unknown-model', offPeak), undefined)
  assert.ok(knownModels().includes('deepseek-flash'))
})

test('cost is cache hit + cache miss + output, reasoning included in output', () => {
  const usage = { inputTokens: 120_000, cacheHitTokens: 118_000, cacheMissTokens: 2_000, outputTokens: 2_800, reasoningTokens: 1_900 }
  const offPeak = new Date('2026-09-15T12:00:00Z')
  // 0.118M * 0.02 + 0.002M * 1 + 0.0028M * 4 = 0.00236 + 0.002 + 0.0112
  assert.ok(Math.abs((costOf(usage, 'deepseek-v4-flash', offPeak) ?? 0) - 0.01556) < 1e-9)
  assert.equal(costOf(usage, 'unknown-model', offPeak), undefined)
  assert.ok(Math.abs((cacheHitRate(usage) ?? 0) - 0.983333) < 1e-5)
})

test('a captured request is stored with its tokens and session', () => {
  const userId = createTokenAccount(db, '成本测试')
  recordUsage(db, {
    userId,
    model: 'deepseek-v4-flash',
    promptChars: 480_000,
    completionChars: 900_000,
    status: 200,
    latencyMs: 1_200,
    tokens: { inputTokens: 120_000, cacheHitTokens: 118_000, cacheMissTokens: 2_000, outputTokens: 2_800, reasoningTokens: 1_900 },
    sessionId: 'sess-1',
    usageSource: 'provider',
  })
  recordUsage(db, {
    userId,
    model: 'deepseek-v4-flash',
    promptChars: 1_000,
    completionChars: 0,
    status: 200,
    latencyMs: 10,
    usageSource: 'missing',
  })

  const rows = db
    .prepare('SELECT * FROM usage WHERE userId = ? ORDER BY id')
    .all(userId) as unknown as Parameters<typeof tokensOf>[0][]
  assert.equal(rows.length, 2)
  assert.ok(tokensOf(rows[0]) !== undefined)
  assert.equal(rows[0].sessionId, 'sess-1')
  // The unaccounted request stays visibly missing.
  assert.equal(tokensOf(rows[1]), undefined)
  assert.equal(rows[1].usageSource, 'missing')

  const days = summarizeDays(rows)
  const summary = days.get(dayOf(rows[0].ts))!
  assert.equal(summary.pricedRequests, 1)
  assert.equal(summary.missingUsage, 1)
  assert.equal(summary.outputTokens, 2_800)
  assert.equal(summary.inputTokens, 120_000)
  assert.ok(summary.cost > 0)

  const users = perUserCost(rows, dayOf(rows[0].ts))
  assert.equal(users[0].userId, userId)
  assert.ok(Math.abs((users[0].hitRate ?? 0) - 0.983333) < 1e-5)
  assert.equal(perSessionCost(rows, dayOf(rows[0].ts))[0].sessionId, 'sess-1')
})

test('an unknown model is reported instead of silently costing zero', () => {
  const userId = createTokenAccount(db, '未知模型')
  recordUsage(db, {
    userId,
    model: 'some-new-model',
    promptChars: 10,
    completionChars: 10,
    status: 200,
    latencyMs: 5,
    tokens: { inputTokens: 10, cacheHitTokens: 0, cacheMissTokens: 10, outputTokens: 10, reasoningTokens: 0 },
    usageSource: 'provider',
  })
  const rows = db.prepare('SELECT * FROM usage WHERE userId = ?').all(userId) as unknown as Parameters<typeof tokensOf>[0][]
  const summary = summarizeDays(rows).get(dayOf(rows[0].ts))!
  assert.deepEqual(summary.unpricedModels, ['some-new-model'])
  assert.equal(summary.pricedRequests, 0)
})

test('percentiles and bill parsing are exact', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9)
  assert.equal(percentile([], 0.9), 0)

  const bills = parseBillArguments(['--bill', '2026-09-14=57.69', '--bill', '2026-09-15=4.32'])
  assert.equal(bills.get('2026-09-14'), 57.69)
  assert.equal(bills.get('2026-09-15'), 4.32)
  assert.throws(() => parseBillArguments(['--bill', 'nonsense']), /--bill/)
  assert.equal(dayOf('2026-09-14T16:30:00.000Z'), '2026-09-15')
})

test('recognises the session-title call and reads the title out of the response', () => {
  const titleBody = Buffer.from(
    JSON.stringify({ messages: [{ role: 'user', content: 'Generate the session title from this JSON array of human messages: ["帮我看看这个表格"]' }] }),
  )
  assert.equal(isTitleRequest(titleBody), true)
  assert.equal(isTitleRequest(Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: '普通提问' }] }))), false)
  assert.equal(isTitleRequest(Buffer.alloc(0)), false)

  // A big agent turn that merely mentions the instruction is not a title call.
  const mentioned = Buffer.from(
    JSON.stringify({
      messages: [{ role: 'user', content: 'x'.repeat(200_000) + 'Generate the session title from this JSON array of human messages:' }],
    }),
  )
  assert.equal(isTitleRequest(mentioned), false)
  // The instruction in a later message is not the title call either.
  const laterMessage = Buffer.from(
    JSON.stringify({ messages: [{ role: 'user', content: '普通提问' }, { role: 'user', content: 'Generate the session title from this' }] }),
  )
  assert.equal(isTitleRequest(laterMessage), false)

  const streamed =
    'data: {"choices":[{"delta":{"content":"表格"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"数据整理"}}]}\n\n' +
    'data: [DONE]\n\n'
  assert.equal(textFromResponseTail(streamed), '表格数据整理')

  const plain = JSON.stringify({ choices: [{ message: { content: '成本核算' } }] })
  assert.equal(textFromResponseTail(plain), '成本核算')
  assert.equal(textFromResponseTail('data: {"choices":[{"delta":{}}]}\n\n'), undefined)

  // A real reply is long: it must never be stored as a title.
  const reply = '这是一段很长的回复正文。'.repeat(40)
  assert.equal(textFromResponseTail(JSON.stringify({ choices: [{ message: { content: reply } }] })), undefined)
})

test('session titles are stored once per session and refreshed in place', () => {
  const userId = createTokenAccount(db, '标题测试')
  assert.equal(recordSessionTitle(db, userId, 'session-a', '修复登录 bug', 'gateway'), true)
  assert.equal(recordSessionTitle(db, userId, 'session-a', '修复登录流程 bug', 'client'), true)
  assert.equal(recordSessionTitle(db, null, 'session-b', '匿名会话', 'client'), false)
  assert.equal(recordSessionTitle(db, userId, null, '没有会话', 'client'), false)
  assert.equal(recordSessionTitle(db, userId, 'session-c', '   ', 'client'), false)

  const titles = loadSessionTitles(db)
  assert.equal(titles.get('session-a')?.title, '修复登录流程 bug')
  assert.equal(titles.get('session-a')?.source, 'client')
  assert.equal(titles.has('session-b'), false)

  const detail = parseSessionTitleDetail(JSON.stringify({ sessionId: 'session-d', title: '写一份周报' }))
  assert.deepEqual(detail, { sessionId: 'session-d', title: '写一份周报' })
  assert.equal(parseSessionTitleDetail('{"sessionId":"x"}'), undefined)
  assert.equal(parseSessionTitleDetail('not json'), undefined)
})

test('titles are classified into work categories', () => {
  assert.equal(classifyTitle('修复 TypeScript 编译报错'), 'coding')
  assert.equal(classifyTitle('把这份 Excel 数据汇总一下'), 'spreadsheet')
  assert.equal(classifyTitle('做一个产品介绍 PPT'), 'slides')
  assert.equal(classifyTitle('写一篇关于茶文化的文章'), 'writing')
  assert.equal(classifyTitle('调研一下竞品的定价'), 'research')
  assert.equal(classifyTitle('帮我整理文件并重命名'), 'files')
  assert.equal(classifyTitle('你好'), 'other')

  const titles = new Map([
    ['session-a', { sessionId: 'session-a', title: '修复 bug', source: 'gateway' }],
    ['session-b', { sessionId: 'session-b', title: '写周报', source: 'client' }],
  ])
  const breakdown = categoryBreakdown(titles, ['session-a', 'session-b', 'session-c'])
  assert.deepEqual(breakdown, [['coding', 1], ['writing', 1], ['other', 1]])
})
