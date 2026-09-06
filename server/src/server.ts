import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hashToken } from './auth.js'
import { findTokenOwner, type GatewayDatabase, type TokenOwner } from './db.js'
import { proxyRequest, type ProxyConfig } from './proxy.js'
import { countRequestsSince, recordUsage, startOfUtcDay } from './usage.js'

export interface GatewayOptions extends ProxyConfig {
  db: GatewayDatabase
  /** Per-user daily request cap; 0 disables the check. */
  dailyLimit: number
}

export function createGatewayServer(options: GatewayOptions) {
  return createServer((request, response) => {
    handleRequest(options, request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: messageFrom(error) })
      } else {
        response.destroy()
      }
    })
  })
}

async function handleRequest(options: GatewayOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
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
