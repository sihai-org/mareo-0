import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { openDatabase, type GatewayDatabase } from '../src/db.js'
import { collect, renderStatsPage } from '../src/stats-page.js'

let directory: string
let db: GatewayDatabase

before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-stats-'))
  db = openDatabase(path.join(directory, 'gateway.db'))
})

after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('the page reports aggregates and escapes anything a client controls', () => {
  const metrics = collect(db)
  const page = renderStatsPage(metrics, { downloads: 3, generatedAt: new Date('2026-09-14T12:00:00Z') })

  assert.match(page, /<html lang="zh-CN">/)
  assert.match(page, /<meta name="robots" content="noindex">/)
  assert.match(page, /官网浏览（近 7 天）/)
  assert.match(page, /额度用尽的请求/)
  assert.match(page, /2026-09-14T12:00:00.000Z/)
  assert.match(page, /安装包下载（近 7 天）/)
  // No external requests: the page works offline and leaks nothing by loading.
  assert.equal(/<script|src="http|href="http/.test(page), false)

  const hostile = renderStatsPage(
    { ...metrics, versions: [{ version: '<script>alert(1)</script>', platform: 'darwin', n: 1 }] },
    { generatedAt: new Date() },
  )
  assert.equal(hostile.includes('<script>alert(1)</script>'), false)
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('an empty database still renders a usable page', () => {
  const empty = openDatabase(path.join(directory, 'empty.db'))
  const page = renderStatsPage(collect(empty), { generatedAt: new Date('2026-09-14T12:00:00Z') })
  assert.match(page, /累计安装/)
  assert.match(page, /暂无数据/)
  empty.close()
})
