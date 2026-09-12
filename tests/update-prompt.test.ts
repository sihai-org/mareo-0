import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { claimUpdatePrompt } from '../src/update-prompt.js'

let root: string

test.before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mareo-update-prompt-'))
})

test.after(async () => {
  await rm(root, { recursive: true, force: true })
})

test('the reminder is claimed once per day', async () => {
  const state = path.join(root, 'update-prompt.json')

  assert.equal(await claimUpdatePrompt(state, '2026-9-12'), true)
  // A restart on the same day stays quiet; the next day reminds again.
  assert.equal(await claimUpdatePrompt(state, '2026-9-12'), false)
  assert.equal(await claimUpdatePrompt(state, '2026-9-13'), true)
})

test('an unreadable record still lets the prompt through', async () => {
  const state = path.join(root, 'broken.json')
  await writeFile(state, 'not json at all')

  assert.equal(await claimUpdatePrompt(state, '2026-9-12'), true)
})

test('a record that cannot be written does not swallow the prompt', async () => {
  const state = path.join(root, 'missing-directory', 'update-prompt.json')

  assert.equal(await claimUpdatePrompt(state, '2026-9-12'), true)
})
