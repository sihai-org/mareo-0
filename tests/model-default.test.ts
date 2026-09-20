import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DEFAULT_MODEL, DEFAULT_PROVIDER, applyDefaultModel, withDefaultModel } from '../src/model-default.js'

const directory = mkdtempSync(path.join(tmpdir(), 'mareo-model-default-'))
test.after(() => rmSync(directory, { recursive: true, force: true }))

const settings = (...lines: string[]): string => [...lines, ''].join('\n')

test('the legacy text-only default is moved to the official model id', () => {
  const updated = withDefaultModel(
    settings(
      'ui-onboarding:',
      '  welcomeNoticeVersion: 2026-08-13.1',
      'agent-default-model:',
      '  provider: deepseek-official',
      '  model: deepseek-v4-flash',
      '  reasoningEffort: high',
    ),
  )
  assert.match(updated, /model: deepseek-flash\n/)
  assert.doesNotMatch(updated, /deepseek-v4-flash/)
  // Every other line is left exactly where it was.
  assert.match(updated, /ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13\.1\nagent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n  reasoningEffort: high\n/)
})

test('a model the account picked itself is never touched', () => {
  for (const model of ['deepseek-v4-pro', 'deepseek-v4-flash-vision-exp', 'some-future-model']) {
    const document = settings('agent-default-model:', '  provider: deepseek-official', `  model: ${model}`)
    // Identity: the file is not rewritten at all once the account has chosen.
    assert.equal(withDefaultModel(document), document, `${model} must be left alone`)
  }
})

test('a document that already uses the official id is returned untouched', () => {
  const document = settings('locale:', '  preference: zh', 'agent-default-model:', '  model: deepseek-flash')
  assert.equal(withDefaultModel(document), document)
})

test('an empty or unrelated settings file gains the block', () => {
  assert.equal(
    withDefaultModel('locale:\n  preference: zh\n'),
    'locale:\n  preference: zh\nagent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n',
  )
  assert.equal(withDefaultModel(''), 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n')
})

test('a block with no model line gets the official id and keeps its other keys', () => {
  const updated = withDefaultModel(settings('agent-default-model:', '  reasoningEffort: low', 'locale:', '  preference: en'))
  assert.equal(updated, 'agent-default-model:\n  reasoningEffort: low\n  model: deepseek-flash\nlocale:\n  preference: en\n')
})

test('an inline mapping is edited in place rather than reformatted', () => {
  const legacy = settings('agent-default-model: {provider: deepseek-official, model: deepseek-v4-flash, reasoningEffort: max}')
  assert.equal(
    withDefaultModel(legacy),
    'agent-default-model: {provider: deepseek-official, model: deepseek-flash, reasoningEffort: max}\n',
  )
  const chosen = settings('agent-default-model: {provider: deepseek-official, model: deepseek-v4-pro}')
  assert.equal(withDefaultModel(chosen), chosen)
})

test('a model key outside the default-model block is not mistaken for it', () => {
  const document = settings('some-other-plugin:', '  model: deepseek-v4-flash', 'agent-default-model:', '  model: deepseek-v4-pro')
  assert.equal(withDefaultModel(document), document)
})

test('carriage returns survive a Windows-written settings file', () => {
  const updated = withDefaultModel(['agent-default-model:', '  model: deepseek-v4-flash', ''].join('\r\n'))
  assert.ok(updated.includes('\r\n'))
  assert.doesNotMatch(updated, /(?<!\r)\n/)
})

test('applying it creates the file, then leaves a chosen model alone', async () => {
  const home = path.join(directory, 'home')
  await applyDefaultModel(home)
  const file = path.join(home, 'settings.yaml')
  assert.equal(readFileSync(file, 'utf8'), `agent-default-model:\n  provider: ${DEFAULT_PROVIDER}\n  model: ${DEFAULT_MODEL}\n`)

  // A second launch changes nothing.
  await applyDefaultModel(home)
  assert.equal(readFileSync(file, 'utf8'), `agent-default-model:\n  provider: deepseek-official\n  model: ${DEFAULT_MODEL}\n`)

  // The stored legacy id is moved once…
  writeFileSync(file, 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n')
  await applyDefaultModel(home)
  assert.match(readFileSync(file, 'utf8'), /model: deepseek-flash/)

  // …and a later choice of the account's own survives every following launch.
  writeFileSync(file, 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-pro\n')
  await applyDefaultModel(home)
  assert.match(readFileSync(file, 'utf8'), /model: deepseek-v4-pro/)
})
