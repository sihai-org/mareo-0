import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDshUrl } from '../src/dsh-runtime.js'

test('extracts the authenticated loopback URL reported by DSH', () => {
  assert.equal(
    extractDshUrl('dsh web: http://127.0.0.1:49152/?token=local-secret\n'),
    'http://127.0.0.1:49152/?token=local-secret',
  )
})

test('does not accept non-loopback addresses', () => {
  assert.equal(extractDshUrl('http://0.0.0.0:3080/?token=secret'), undefined)
  assert.equal(extractDshUrl('https://127.0.0.1:3080/?token=secret'), undefined)
})

test('requires the authenticated DSH launch URL', () => {
  assert.equal(extractDshUrl('http://127.0.0.1:3080/'), undefined)
})
