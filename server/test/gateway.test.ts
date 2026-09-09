import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { hashToken } from '../src/auth.js'
import { createTokenAccount, findTokenOwner, openDatabase, storeToken, type GatewayDatabase } from '../src/db.js'
import { createGatewayServer } from '../src/server.js'
import { countRequestsSince, startOfUtcDay } from '../src/usage.js'

const UPSTREAM_KEY = 'sk-gateway-own-key'

/** Stands in for api.deepseek.com so tests never need a real key. */
function createStubUpstream(): Promise<{ server: Server; url: string; lastAuthorization: () => string | undefined }> {
  let lastAuthorization: string | undefined
  const server = createHttpServer((request, response) => {
    lastAuthorization = request.headers.authorization
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const model = body ? (JSON.parse(body) as { model?: string }).model : undefined
      if (request.url?.startsWith('/stream')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"delta":"first"}\n\n')
        setTimeout(() => {
          response.write('data: {"delta":"second"}\n\n')
          response.end()
        }, 20)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, echoModel: model ?? null }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('stub upstream did not bind a port')
      resolve({ server, url: `http://127.0.0.1:${address.port}`, lastAuthorization: () => lastAuthorization })
    })
  })
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('gateway did not bind a port')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function issueToken(db: GatewayDatabase, displayName: string, secret: string): Promise<string> {
  const userId = createTokenAccount(db, displayName)
  storeToken(db, { userId, label: `${displayName} token`, tokenHash: hashToken(secret) })
  return userId
}

let directory: string
let stub: Awaited<ReturnType<typeof createStubUpstream>>
let gateway: Server
let db: GatewayDatabase
let gatewayUrl: string
let token: string

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-gateway-e2e-'))
  db = openDatabase(path.join(directory, 'gateway.db'))
  stub = await createStubUpstream()
  gateway = createGatewayServer({
    db,
    upstreamBaseUrl: stub.url,
    apiKey: UPSTREAM_KEY,
    dailyLimit: 100,
  })
  gatewayUrl = await listen(gateway)
  token = 'e2e-token-secret'
  await issueToken(db, 'E2E User', token)
})

after(async () => {
  await close(gateway)
  await close(stub.server)
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('rejects unauthenticated model requests', async () => {
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, { method: 'POST' })
  assert.equal(response.status, 401)
})

test('/me returns the token owner with its account id', async () => {
  const response = await fetch(`${gatewayUrl}/me`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  const body = (await response.json()) as { displayName: string; accountId: string }
  assert.equal(body.displayName, 'E2E User')
  assert.equal(typeof body.accountId, 'string')
})

test('proxies a chat completion and records usage with the owner and model', async () => {
  const body = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, echoModel: 'deepseek-chat' })
  assert.equal(stub.lastAuthorization(), `Bearer ${UPSTREAM_KEY}`)

  const userId = findTokenOwner(db, hashToken(token))?.userId
  assert.ok(userId !== undefined)
  assert.equal(countRequestsSince(db, userId, startOfUtcDay()), 1)
})

test('streams event-stream responses through', async () => {
  const response = await fetch(`${gatewayUrl}/stream`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    body: JSON.stringify({ stream: true }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const text = await response.text()
  assert.ok(text.includes('first'))
  assert.ok(text.includes('second'))
})

test('enforces the per-user daily limit', async () => {
  // Use a dedicated database so usage from the other tests does not leak in.
  const limitedDb = openDatabase(path.join(directory, 'limited.db'))
  const limitedToken = 'limited-user-secret'
  await issueToken(limitedDb, 'Limited User', limitedToken)
  const limited = createGatewayServer({ db: limitedDb, upstreamBaseUrl: stub.url, apiKey: UPSTREAM_KEY, dailyLimit: 1 })
  const limitedUrl = await listen(limited)
  const callChat = (): Promise<Response> =>
    fetch(`${limitedUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${limitedToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat' }),
    })
  try {
    assert.equal((await callChat()).status, 200)
    assert.equal((await callChat()).status, 429)
  } finally {
    await close(limited)
    limitedDb.close()
  }
})

test('renames the account and signs out (revokes) the current token', async () => {
  const secret = 'account-ops-secret'
  await issueToken(db, 'Ops User', secret)
  const auth = { authorization: `Bearer ${secret}` }

  const rename = await fetch(`${gatewayUrl}/account/name`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: '新名字' }),
  })
  assert.equal(rename.status, 200)
  const me = await fetch(`${gatewayUrl}/me`, { headers: auth })
  assert.equal(((await me.json()) as { displayName: string }).displayName, '新名字')

  const signOut = await fetch(`${gatewayUrl}/account/sign-out`, { method: 'POST', headers: auth })
  assert.equal(signOut.status, 200)
  const after = await fetch(`${gatewayUrl}/me`, { headers: auth })
  assert.equal(after.status, 401)
})
