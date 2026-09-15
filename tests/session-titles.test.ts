import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readSessionTitles, unreportedTitles } from '../src/session-titles.js'

let root: string

test.before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mareo-session-titles-'))
})

test.after(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A session record shaped like the engine's own projection files. */
async function writeSession(dshHome: string, file: string, title: unknown): Promise<void> {
  const directory = path.join(dshHome, 'storages', 'session_projcache', 'sessions')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, file), JSON.stringify({ version: 5, record: { rows: { title: { val: title } } } }))
}

test('reads titles from the engine session store and normalises session ids', async () => {
  const dshHome = path.join(root, 'home-a')
  await writeSession(dshHome, 'session-abc.json', '把 Excel 汇总成一张表')
  await writeSession(dshHome, 'def.json', '写一份周报')
  await writeSession(dshHome, 'session-empty.json', null)
  await writeSession(dshHome, 'session-blank.json', '   ')
  await writeFile(path.join(dshHome, 'storages', 'session_projcache', 'sessions', 'broken.json'), 'not json')

  const titles = (await readSessionTitles(dshHome)).sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  assert.deepEqual(titles, [
    { sessionId: 'session-abc', title: '把 Excel 汇总成一张表' },
    { sessionId: 'session-def', title: '写一份周报' },
  ])
})

test('a missing session store is not an error', async () => {
  assert.deepEqual(await readSessionTitles(path.join(root, 'no-such-home')), [])
})

test('each title is reported once, and a changed title is reported again', async () => {
  const statePath = path.join(root, 'reported.json')
  const first = await unreportedTitles(statePath, [{ sessionId: 'session-1', title: '修复 bug' }])
  assert.deepEqual(first, [{ sessionId: 'session-1', title: '修复 bug' }])

  // Nothing new on the next pass.
  assert.deepEqual(await unreportedTitles(statePath, [{ sessionId: 'session-1', title: '修复 bug' }]), [])
  // A refreshed title goes out again.
  assert.deepEqual(await unreportedTitles(statePath, [{ sessionId: 'session-1', title: '修复登录 bug' }]), [
    { sessionId: 'session-1', title: '修复登录 bug' },
  ])
  // A new session is reported.
  assert.deepEqual(await unreportedTitles(statePath, [{ sessionId: 'session-2', title: '写周报' }]), [
    { sessionId: 'session-2', title: '写周报' },
  ])

  // Unreadable state must not block reporting.
  await writeFile(statePath, 'not json')
  assert.deepEqual(await unreportedTitles(statePath, [{ sessionId: 'session-3', title: '调研' }]), [
    { sessionId: 'session-3', title: '调研' },
  ])
})
