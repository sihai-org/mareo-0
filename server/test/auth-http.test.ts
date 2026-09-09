import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { openDatabase, type GatewayDatabase } from '../src/db.js'
import { createGatewayServer } from '../src/server.js'

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('did not bind')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

let directory: string
let db: GatewayDatabase
let gateway: Server
let url: string
let sentCode = ''
let sentTo = ''

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-auth-http-'))
  db = openDatabase(path.join(directory, 'auth.db'))
  gateway = createGatewayServer({
    db,
    upstreamBaseUrl: 'http://127.0.0.1:1',
    apiKey: 'unused',
    dailyLimit: 0,
    mailer: {
      async sendCode(to, code) {
        sentTo = to
        sentCode = code
      },
    },
  })
  url = await listen(gateway)
})

after(async () => {
  await close(gateway)
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('email code flow signs a brand-new account in', async () => {
  const send = await fetch(`${url}/auth/email/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'NewUser@Mareo.cn' }),
  })
  assert.equal(send.status, 200)
  assert.equal(sentTo, 'newuser@mareo.cn')
  assert.ok(/^\d{6}$/.test(sentCode))

  const verify = await fetch(`${url}/auth/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'newuser@mareo.cn', code: sentCode }),
  })
  assert.equal(verify.status, 200)
  const { token, displayName } = (await verify.json()) as { token: string; displayName: string }
  assert.equal(displayName, 'newuser')
  assert.ok(token.length > 10)

  const me = await fetch(`${url}/me`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(me.status, 200)
  assert.deepEqual(await me.json(), { displayName: 'newuser' })
})

test('wrong codes and bad requests are rejected', async () => {
  const send = await fetch(`${url}/auth/email/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'second@mareo.cn' }),
  })
  assert.equal(send.status, 200)

  const wrong = await fetch(`${url}/auth/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'second@mareo.cn', code: '000000' }),
  })
  assert.equal(wrong.status, 400)
  assert.deepEqual(await wrong.json(), { error: 'wrong-code' })

  const badEmail = await fetch(`${url}/auth/email/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  assert.equal(badEmail.status, 400)

  const providers = await fetch(`${url}/auth/providers`)
  assert.equal(providers.status, 200)
  assert.deepEqual(await providers.json(), { providers: ['email'] })
})
