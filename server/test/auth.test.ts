import assert from 'node:assert/strict'
import test from 'node:test'
import { generateTokenSecret, hashToken, secureEqual } from '../src/auth.js'

test('generates distinct 32-byte base64url secrets', () => {
  const first = generateTokenSecret()
  const second = generateTokenSecret()
  assert.equal(first.length, 43)
  assert.notEqual(first, second)
})

test('hashing is deterministic and one-way', () => {
  const secret = generateTokenSecret()
  assert.equal(hashToken(secret), hashToken(secret))
  assert.notEqual(hashToken(secret), hashToken(`${secret}x`))
})

test('secureEqual compares constant-time', () => {
  const value = generateTokenSecret()
  assert.equal(secureEqual(value, value), true)
  assert.equal(secureEqual(value, `${value}x`), false)
  assert.equal(secureEqual('a', 'bbbb'), false)
})
