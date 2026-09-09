import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The gateway this Mareo talks to. Packaged builds use the production gateway;
 * local development keeps using a locally running gateway. MAREO_GATEWAY_URL
 * always wins, so either mode can be pointed anywhere for testing.
 */
export const GATEWAY_URL =
  process.env.MAREO_GATEWAY_URL ?? (app.isPackaged ? 'https://api.svc.mareo.cn' : 'http://127.0.0.1:3000')

const ACCOUNT_FILE = 'account.dat'

function accountPath(): string {
  return path.join(app.getPath('userData'), ACCOUNT_FILE)
}

function decodeStored(raw: string): { token?: string } | undefined {
  try {
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
      : Buffer.from(raw, 'base64').toString('utf8')
    return JSON.parse(json) as { token?: string }
  } catch {
    return undefined
  }
}

export function loadAccountToken(): string | undefined {
  let raw: string
  try {
    raw = readFileSync(accountPath(), 'utf8')
  } catch {
    return undefined
  }
  const account = decodeStored(raw)
  return typeof account?.token === 'string' && account.token !== '' ? account.token : undefined
}

export function saveAccountToken(token: string): void {
  const json = JSON.stringify({ token })
  const raw = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json).toString('base64')
    : Buffer.from(json, 'utf8').toString('base64')
  mkdirSync(path.dirname(accountPath()), { recursive: true })
  writeFileSync(accountPath(), raw, { mode: 0o600 })
}

export function clearAccount(): void {
  try {
    rmSync(accountPath(), { force: true })
  } catch {
    // Nothing stored is fine.
  }
}

export type TokenCheck =
  | { valid: true; displayName: string }
  | { valid: false; reason: 'invalid' | 'unreachable' }

export async function checkToken(token: string): Promise<TokenCheck> {
  try {
    const response = await fetch(`${GATEWAY_URL}/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 200) {
      const body = (await response.json()) as { displayName?: string }
      return { valid: true, displayName: body.displayName ?? 'Mareo user' }
    }
    if (response.status === 401) return { valid: false, reason: 'invalid' }
    return { valid: false, reason: 'unreachable' }
  } catch {
    return { valid: false, reason: 'unreachable' }
  }
}

export type EmailCodeRequest =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'daily-limit' | 'invalid-email' | 'delivery-failed' | 'unreachable' }

export async function requestEmailCode(email: string): Promise<EmailCodeRequest> {
  try {
    const response = await fetch(`${GATEWAY_URL}/auth/email/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 200) return { ok: true }
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'cooldown' || body.error === 'daily-limit') return { ok: false, reason: body.error }
    if (body.error === 'invalid-email') return { ok: false, reason: 'invalid-email' }
    if (body.error === 'delivery-failed') return { ok: false, reason: 'delivery-failed' }
    return { ok: false, reason: 'unreachable' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

export type EmailSignIn =
  | { ok: true; token: string; displayName: string }
  | {
      ok: false
      reason: 'no-code' | 'expired' | 'too-many-attempts' | 'wrong-code' | 'invalid-request' | 'unreachable'
    }

export async function signInWithEmailCode(email: string, code: string): Promise<EmailSignIn> {
  try {
    const response = await fetch(`${GATEWAY_URL}/auth/email/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 200) {
      const body = (await response.json()) as { token?: string; displayName?: string }
      if (typeof body.token !== 'string') return { ok: false, reason: 'unreachable' }
      return { ok: true, token: body.token, displayName: body.displayName ?? 'Mareo user' }
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    const reason = body.error ?? ''
    if (
      reason === 'no-code' ||
      reason === 'expired' ||
      reason === 'too-many-attempts' ||
      reason === 'wrong-code' ||
      reason === 'invalid-request'
    ) {
      return { ok: false, reason }
    }
    return { ok: false, reason: 'unreachable' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
