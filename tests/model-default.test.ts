import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DEFAULT_MODEL, applyDefaultModel, withDefaultModel } from '../src/model-default.js'

const directory = mkdtempSync(path.join(tmpdir(), 'mareo-model-default-'))
test.after(() => rmSync(directory, { recursive: true, force: true }))

test('the legacy text-only default is replaced by the official model id', () => {
  const document = [
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    'agent-default-model:',
    '  provider: deepseek-official',
    '  model: deepseek-v4-flash',
    '  reasoningEffort: high',
    '',
  ].join('\n')
  const updated = withDefaultModel(document)
  assert.match(updated, /model: deepseek-flash\n/)
  assert.doesNotMatch(updated, /deepseek-v4-flash/)
  // Everything else is left exactly as it was.
  assert.match(updated, /ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13\.1\n/)
  assert.match(updated, /  reasoningEffort: high\n/)
})

test('a model chosen in a previous session is overridden too', () => {
  const document = ['agent-default-model:', '  provider: deepseek-official', '  model: deepseek-v4-pro', ''].join('\n')
  assert.match(withDefaultModel(document), /model: deepseek-flash/)
  assert.doesNotMatch(withDefaultModel(document), /deepseek-v4-pro/)
})

test('a document that already pins the model is returned untouched', () => {
  const document = [
    'locale:',
    '  preference: zh',
    'agent-default-model:',
    '  provider: deepseek-official',
    '  model: deepseek-flash',
    '',
  ].join('\n')
  // Identity, not just equality: an unchanged document must not be rewritten.
  assert.equal(withDefaultModel(document), document)
})

test('an empty or unrelated settings file gains the block', () => {
  const appended = withDefaultModel('locale:\n  preference: zh\n')
  assert.match(appended, /locale:\n  preference: zh\nagent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n$/)

  const empty = withDefaultModel('')
  assert.equal(empty, 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n')
})

test('a block without a model line gets one, and keeps its other keys', () => {
  const document = ['agent-default-model:', '  reasoningEffort: low', 'locale:', '  preference: en', ''].join('\n')
  const updated = withDefaultModel(document)
  assert.match(updated, /agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n  reasoningEffort: low\nlocale:/)
})

test('an inline mapping is rewritten in block form without losing its keys', () => {
  const document = ['agent-default-model: {provider: deepseek-official, model: deepseek-v4-flash, reasoningEffort: max}', ''].join('\n')
  const updated = withDefaultModel(document)
  assert.match(updated, /agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n  reasoningEffort: max\n/)
})

test('carriage returns survive a Windows-written settings file', () => {
  const updated = withDefaultModel(['locale:', '  preference: zh', 'agent-default-model:', '  model: deepseek-v4-flash', ''].join('\r\n'))
  assert.ok(updated.includes('\r\n'))
  assert.doesNotMatch(updated, /(?<!\r)\n/)
})

test('applying it creates the file, then leaves it alone once correct', async () => {
  const home = path.join(directory, 'home')
  await applyDefaultModel(home)
  const file = path.join(home, 'settings.yaml')
  assert.equal(readFileSync(file, 'utf8'), `agent-default-model:\n  provider: deepseek-official\n  model: ${DEFAULT_MODEL}\n`)

  // The second launch must not touch the file: mtime stays put.
  const before = readFileSync(file, 'utf8')
  await applyDefaultModel(home)
  assert.equal(readFileSync(file, 'utf8'), before)

  writeFileSync(file, 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n')
  await applyDefaultModel(home)
  assert.match(readFileSync(file, 'utf8'), /model: deepseek-flash/)
})
