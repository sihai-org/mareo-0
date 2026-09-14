import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDshUrl, reportableErrorOutput } from '../src/dsh-runtime.js'

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

test('the crash tail keeps the technical part and drops paths and tokens', () => {
  const raw = [
    'info: starting',
    "Error: Cannot find module '/Users/zhefeng/Mareo/resources/dsh-runtime/index.js'",
    'at Module._resolveFilename (/Users/zhefeng/Mareo/app.asar/node_modules/x.js:12:5)',
    'Launch URL: http://127.0.0.1:4567/?token=super-secret-token',
  ].join('\n')

  const tail = reportableErrorOutput(raw)
  assert.equal(tail.includes('/Users/zhefeng'), false)
  assert.equal(tail.includes('super-secret-token'), false)
  assert.match(tail, /Cannot find module/)
  assert.match(tail, /\[REDACTED\]/)
})

test('the crash tail is bounded by lines and by size', () => {
  const many = Array.from({ length: 50 }, (_value, index) => `line ${index}`).join('\n')
  const capped = reportableErrorOutput(many)
  assert.equal(capped.split('\n').length, 20)
  // The newest lines are the ones that matter.
  assert.match(capped, /line 49$/)

  const huge = 'x'.repeat(9_000)
  assert.equal(reportableErrorOutput(huge).length, 4_000)
  // Blank lines never pad the report.
  assert.equal(reportableErrorOutput('\n\n  \n'), '')
})
