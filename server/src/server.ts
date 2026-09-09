import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { generateTokenSecret, hashToken } from './auth.js'
import { findOrCreateAccountForIdentity, findTokenOwner, storeToken, type GatewayDatabase, type TokenOwner } from './db.js'
import { beginEmailCode, isValidEmail, normalizeEmail, verifyEmailCode } from './email-auth.js'
import { createEmailMailer, type Mailer } from './mailer.js'
import { proxyRequest, type ProxyConfig } from './proxy.js'
import { countRequestsSince, recordUsage, startOfUtcDay } from './usage.js'

export interface GatewayOptions extends ProxyConfig {
  db: GatewayDatabase
  /** Per-user daily request cap; 0 disables the check. */
  dailyLimit: number
  /** Verification-code delivery; defaults to SMTP from the environment. */
  mailer?: Mailer
}

export function createGatewayServer(options: GatewayOptions) {
  const mailer = options.mailer ?? createEmailMailer()
  return createServer((request, response) => {
    handleRequest(options, request, response, mailer).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: messageFrom(error) })
      } else {
        response.destroy()
      }
    })
  })
}

async function handleRequest(
  options: GatewayOptions,
  request: IncomingMessage,
  response: ServerResponse,
  mailer: Mailer,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://gateway.local').pathname

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && pathname === '/me') {
    const owner = authenticate(request, options.db)
    if (!owner) {
      sendJson(response, 401, { error: 'invalid token' })
      return
    }
    sendJson(response, 200, { displayName: owner.displayName })
    return
  }

  if (pathname === '/auth/providers') {
    sendJson(response, 200, { providers: ['email'] })
    return
  }

  if (pathname === '/auth/email/send') {
    await handleEmailSend(options, request, response, mailer)
    return
  }

  if (pathname === '/auth/email/verify') {
    await handleEmailVerify(options, request, response)
    return
  }

  if (pathname.startsWith('/auth/')) {
    sendJson(response, 404, { error: 'not found' })
    return
  }

  // Every other path (the model API and anything else DeepSeek serves) is proxied.
  const owner = authenticate(request, options.db)
  if (!owner) {
    sendJson(response, 401, { error: 'invalid token' })
    return
  }

  if (
    options.dailyLimit > 0 &&
    countRequestsSince(options.db, owner.userId, startOfUtcDay()) >= options.dailyLimit
  ) {
    sendJson(response, 429, { error: 'daily request limit reached' })
    return
  }

  const outcome = await proxyRequest(request, response, options)
  try {
    recordUsage(options.db, {
      userId: owner.userId,
      model: outcome.model,
      promptChars: outcome.promptChars,
      completionChars: outcome.completionChars,
      status: outcome.status,
      latencyMs: outcome.latencyMs,
    })
  } catch {
    // Usage accounting must never break a successful proxy exchange.
  }
}

async function handleEmailSend(
  options: GatewayOptions,
  request: IncomingMessage,
  response: ServerResponse,
  mailer: Mailer,
): Promise<void> {
  const body = await readJsonBody(request)
  if (!body || typeof body.email !== 'string' || !isValidEmail(body.email)) {
    sendJson(response, 400, { error: 'invalid-email' })
    return
  }
  const email = normalizeEmail(body.email)
  const outcome = beginEmailCode(options.db, email)
  if (!outcome.ok) {
    sendJson(response, 429, { error: outcome.reason })
    return
  }
  try {
    await mailer.sendCode(email, outcome.code)
  } catch (error) {
    console.error('[email] delivery failed:', messageFrom(error))
    sendJson(response, 503, { error: 'delivery-failed' })
    return
  }
  sendJson(response, 200, { ok: true })
}

async function handleEmailVerify(options: GatewayOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request)
  if (!body || typeof body.email !== 'string' || typeof body.code !== 'string' || !isValidEmail(body.email)) {
    sendJson(response, 400, { error: 'invalid-request' })
    return
  }
  const email = normalizeEmail(body.email)
  const check = verifyEmailCode(options.db, email, body.code)
  if (!check.ok) {
    sendJson(response, 400, { error: check.reason })
    return
  }
  const account = findOrCreateAccountForIdentity(options.db, 'email', email, displayNameForEmail(email))
  const secret = generateTokenSecret()
  storeToken(options.db, { userId: account.id, label: 'email-login', tokenHash: hashToken(secret) })
  sendJson(response, 200, { token: secret, displayName: account.displayName })
}

function displayNameForEmail(email: string): string {
  return email.split('@')[0].slice(0, 32) || 'Mareo 用户'
}

async function readJsonBody(request: IncomingMessage): Promise<{ email?: unknown; code?: unknown } | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > 16 * 1024) return undefined
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { email?: unknown; code?: unknown }
    return parsed
  } catch {
    return undefined
  }
}

function authenticate(request: IncomingMessage, db: GatewayDatabase): TokenOwner | undefined {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  return findTokenOwner(db, hashToken(header.slice('Bearer '.length).trim()))
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
