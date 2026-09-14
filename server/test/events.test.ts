import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { hashToken } from '../src/auth.js'
import { createTokenAccount, openDatabase, storeToken, type GatewayDatabase } from '../src/db.js'
import { createAnonymousEventLimiter, parseEvents } from '../src/events.js'
import { createGatewayServer } from '../src/server.js'

let directory: string
let gateway: Server
let db: GatewayDatabase
let gatewayUrl: string
let accountId: string
const token = 'events-token-secret'

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-events-'))
  db = openDatabase(path.join(directory, 'gateway.db'))
  gateway = createGatewayServer({
    db,
    upstreamBaseUrl: 'http://127.0.0.1:1',
    apiKey: 'sk-unused',
    dailyLimit: 0,
    anonymousEventLimiter: createAnonymousEventLimiter(3, 60_000),
  })
  gatewayUrl = await new Promise<string>((resolve) => {
    gateway.listen(0, '127.0.0.1', () => {
      const address = gateway.address()
      if (address === null || typeof address === 'string') throw new Error('gateway did not bind a port')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
  accountId = createTokenAccount(db, '事件测试')
  storeToken(db, { userId: accountId, label: 'test', tokenHash: hashToken(token) })
})

after(async () => {
  await new Promise<void>((resolve, reject) => gateway.close((error) => (error ? reject(error) : resolve())))
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function postEvents(body: unknown, options: { token?: string; ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  if (options.ip) headers['x-real-ip'] = options.ip
  return fetch(`${gatewayUrl}/events`, { method: 'POST', headers, body: JSON.stringify(body) })
}

function storedEvents(): { accountId: string | null; name: string; version: string | null; detail: string | null }[] {
  return db
    .prepare('SELECT accountId, name, version, detail FROM events ORDER BY id')
    .all() as { accountId: string | null; name: string; version: string | null; detail: string | null }[]
}

test('stores signed-in events against the account', async () => {
  const response = await postEvents(
    {
      events: [
        { name: 'install_confirmed', version: '0.1.3', platform: 'darwin', detail: '{"arch":"arm64"}' },
        { name: 'launch', version: '0.1.3', platform: 'darwin', detail: '{"ok":true,"ms":1200}' },
      ],
    },
    { token },
  )
  assert.equal(response.status, 200)
  const rows = storedEvents()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'install_confirmed')
  assert.equal(rows[0].accountId, accountId)
  assert.equal(rows[1].detail, '{"ok":true,"ms":1200}')
})

test('accepts anonymous events so sign-in failures are visible', async () => {
  const response = await postEvents({ events: [{ name: 'signin', platform: 'darwin', detail: '{"result":"wrong-code"}' }] })
  assert.equal(response.status, 200)
  const row = storedEvents().at(-1)!
  assert.equal(row.name, 'signin')
  assert.equal(row.accountId, null)
})

test('drops unknown names, junk entries and oversized payloads', async () => {
  const before = storedEvents().length
  assert.equal((await postEvents({ events: [{ name: 'chat_message', detail: '{"text":"secret"}' }] }, { token })).status, 400)
  assert.equal((await postEvents({ events: [] }, { token })).status, 400)
  assert.equal((await postEvents({ events: 'nope' }, { token })).status, 400)
  assert.equal(
    (await postEvents({ events: Array.from({ length: 21 }, () => ({ name: 'launch' })) }, { token })).status,
    400,
  )
  assert.equal(storedEvents().length, before)
})

test('truncates long detail instead of storing content', async () => {
  const response = await postEvents({ events: [{ name: 'harness_exit', detail: 'x'.repeat(9_000) }] }, { token })
  assert.equal(response.status, 200)
  assert.equal(storedEvents().at(-1)!.detail?.length, 4_000)
})

test('caps anonymous events per address', async () => {
  const ip = '203.0.113.9'
  const statuses: number[] = []
  for (let index = 0; index < 5; index += 1) {
    statuses.push((await postEvents({ events: [{ name: 'signin' }] }, { ip })).status)
  }
  assert.deepEqual(statuses, [200, 200, 200, 429, 429])
  // A signed-in client is not limited by the anonymous budget.
  assert.equal((await postEvents({ events: [{ name: 'launch' }] }, { token, ip })).status, 200)
})

test('parsing keeps only the closed set of event fields', () => {
  const parsed = parseEvents({
    events: [{ name: 'launch', version: '0.1.3', platform: 'darwin', email: 'a@b.c', prompt: 'secret' }],
  })
  assert.deepEqual(parsed, [{ name: 'launch', version: '0.1.3', platform: 'darwin' }])
})
