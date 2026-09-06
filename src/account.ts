import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The gateway this Mareo build talks to. Local development defaults to a
 * locally running gateway; a distribution build overrides it with the product
 * gateway (for example via MAREO_GATEWAY_URL or a baked-in constant).
 */
export const GATEWAY_URL = process.env.MAREO_GATEWAY_URL ?? 'http://127.0.0.1:3000'

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
