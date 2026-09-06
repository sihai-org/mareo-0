import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type GatewayDatabase = DatabaseSync

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  tokenHash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  revokedAt TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL REFERENCES users(id),
  ts TEXT NOT NULL,
  model TEXT,
  promptChars INTEGER NOT NULL,
  completionChars INTEGER NOT NULL,
  status INTEGER NOT NULL,
  latencyMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_tokenHash ON tokens(tokenHash);
CREATE INDEX IF NOT EXISTS idx_usage_userId_ts ON usage(userId, ts);
`

export function openDatabase(dbPath: string): GatewayDatabase {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(SCHEMA)
  return db
}

export interface NewUser {
  displayName: string
  provider: string
  subject?: string | null
}

export function createUser(db: GatewayDatabase, user: NewUser): string {
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, displayName, provider, subject) VALUES (?, ?, ?, ?)').run(
    id,
    user.displayName,
    user.provider,
    user.subject ?? null,
  )
  return id
}

export interface StoredToken {
  userId: string
  label: string
  tokenHash: string
}

export function storeToken(db: GatewayDatabase, token: StoredToken): void {
  db.prepare('INSERT INTO tokens (id, userId, tokenHash, label) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    token.userId,
    token.tokenHash,
    token.label,
  )
}

export interface TokenOwner {
  userId: string
  displayName: string
}

export function findTokenOwner(db: GatewayDatabase, tokenHash: string): TokenOwner | undefined {
  const row = db
    .prepare(
      `SELECT t.userId AS userId, u.displayName AS displayName
       FROM tokens t JOIN users u ON u.id = t.userId
       WHERE t.tokenHash = ? AND t.revokedAt IS NULL`,
    )
    .get(tokenHash) as { userId: string; displayName: string } | undefined
  if (row === undefined) return undefined
  return { userId: row.userId, displayName: row.displayName }
}
