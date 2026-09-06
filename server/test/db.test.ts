import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createUser, findTokenOwner, openDatabase, storeToken, type GatewayDatabase } from '../src/db.js'
import { hashToken } from '../src/auth.js'
import { countRequestsSince, recordUsage, startOfUtcDay } from '../src/usage.js'

let directory: string
let dbPath: string
let db: GatewayDatabase

test.before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-gateway-'))
  dbPath = path.join(directory, 'test.db')
  db = openDatabase(dbPath)
})

test.after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('issues a token that resolves to its owner and rejects unknown hashes', () => {
  const userId = createUser(db, { displayName: 'Ada', provider: 'token' })
  const secret = 'test-secret'
  storeToken(db, { userId, label: 'Ada token', tokenHash: hashToken(secret) })

  assert.deepEqual(findTokenOwner(db, hashToken(secret)), { userId, displayName: 'Ada' })
  assert.equal(findTokenOwner(db, hashToken('unknown-secret')), undefined)
})

test('records usage and counts requests since a timestamp', () => {
  const userId = createUser(db, { displayName: 'Grace', provider: 'token' })
  const before = startOfUtcDay()
  recordUsage(db, { userId, model: 'deepseek-chat', promptChars: 10, completionChars: 20, status: 200, latencyMs: 5 })
  recordUsage(db, { userId, model: 'deepseek-reasoner', promptChars: 3, completionChars: 7, status: 429, latencyMs: 1 })

  assert.equal(countRequestsSince(db, userId, before), 2)
  assert.equal(countRequestsSince(db, createUser(db, { displayName: 'Nobody', provider: 'token' }), before), 0)
})
