import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createTokenAccount, openDatabase, type GatewayDatabase } from '../src/db.js'
import { countRequestsSince, recordUsage, startOfUtcDay } from '../src/usage.js'
import { dayStamp, parseSiteView, recordSiteView, siteViewsSince } from '../src/site-views.js'

let directory: string
let db: GatewayDatabase

before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-site-views-'))
  db = openDatabase(path.join(directory, 'gateway.db'))
})

after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('only the counted website paths are accepted and normalised', () => {
  assert.deepEqual(parseSiteView({ path: '/' }), { path: '/' })
  assert.deepEqual(parseSiteView({ path: '/index.html' }), { path: '/' })
  assert.deepEqual(parseSiteView({ path: '/privacy.html?from=footer' }), { path: '/privacy.html' })
  assert.equal(parseSiteView({ path: '/updates/latest.json' }), undefined)
  assert.equal(parseSiteView({ path: '/../../etc/passwd' }), undefined)
  assert.equal(parseSiteView({ path: 42 }), undefined)
  assert.equal(parseSiteView(null), undefined)
})

test('views accumulate per day and per path, without storing a visitor', () => {
  const firstDay = new Date('2026-09-14T10:00:00+08:00')
  const secondDay = new Date('2026-09-15T10:00:00+08:00')
  recordSiteView(db, '/', firstDay)
  recordSiteView(db, '/', firstDay)
  recordSiteView(db, '/privacy.html', firstDay)
  recordSiteView(db, '/', secondDay)

  const bothDays = siteViewsSince(db, dayStamp(firstDay))
  assert.equal(bothDays.total, 4)
  assert.deepEqual(bothDays.byPath, [
    { path: '/', count: 3 },
    { path: '/privacy.html', count: 1 },
  ])
  // Since the later day only the one view from that day is counted.
  assert.equal(siteViewsSince(db, dayStamp(secondDay)).total, 1)

  // The table has no column that could identify a visitor.
  const columns = (db.prepare('PRAGMA table_info(site_views)').all() as { name: string }[]).map((row) => row.name)
  assert.deepEqual(columns, ['day', 'path', 'count'])
})

test('a rejected request is recorded so the cap is visible', () => {
  const userId = createTokenAccount(db, '额度测试')
  const before = countRequestsSince(db, userId, startOfUtcDay())
  recordUsage(db, { userId, model: null, promptChars: 0, completionChars: 0, status: 429, latencyMs: 0 })
  assert.equal(countRequestsSince(db, userId, startOfUtcDay()), before + 1)
  const limited = db.prepare('SELECT count(*) n FROM usage WHERE status = 429').get() as { n: number }
  assert.equal(limited.n, 1)
})
