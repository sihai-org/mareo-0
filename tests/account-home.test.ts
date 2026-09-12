import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareAccountHome } from '../src/account-home.js'

let root: string

test.before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mareo-account-home-'))
})

test.after(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A DSH base directory holding the pre-isolation shared home. */
async function dshBaseWithLegacyState(): Promise<string> {
  const base = path.join(await mkdtemp(path.join(root, 'dsh-')), 'dsh')
  await mkdir(path.join(base, 'sessions', 's1'), { recursive: true })
  await writeFile(path.join(base, 'sessions', 's1', 'session.jsonl'), '{}')
  await mkdir(path.join(base, 'storages'), { recursive: true })
  await writeFile(path.join(base, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: x\n')
  // Credentials must never follow an account migration.
  await writeFile(path.join(base, '.credentials.yaml'), 'secret')
  return base
}

test('the first account takes over the pre-isolation state', async () => {
  const base = await dshBaseWithLegacyState()
  const home = await prepareAccountHome(base, 'acct-1')

  assert.equal(home, path.join(base, 'accounts', 'acct-1'))
  assert.equal(await exists(path.join(home, 'sessions', 's1', 'session.jsonl')), true)
  assert.equal(await exists(path.join(home, 'storages')), true)
  assert.equal(await exists(path.join(home, 'settings.yaml')), true)
  // Credentials are left behind on purpose, and the shared home is emptied so
  // that nothing can be handed to another account.
  assert.equal(await exists(path.join(home, '.credentials.yaml')), false)
  assert.equal(await exists(path.join(base, 'sessions')), false)
  assert.equal(await exists(path.join(base, 'settings.yaml')), false)

  // Running again for the same account keeps its state.
  await prepareAccountHome(base, 'acct-1')
  assert.equal(await exists(path.join(home, 'sessions', 's1', 'session.jsonl')), true)
})

test('an account created later never sees the pre-isolation state', async () => {
  const base = await dshBaseWithLegacyState()
  await prepareAccountHome(base, 'acct-1')
  const home = await prepareAccountHome(base, 'acct-2')

  assert.equal(await exists(path.join(home, 'sessions')), false)
  assert.equal(await exists(path.join(home, 'storages')), false)
  assert.equal(await exists(path.join(home, 'settings.yaml')), false)
})

test('leftover shared state is discarded once another account exists', async () => {
  const base = await dshBaseWithLegacyState()
  // An older build copied the shared home into every account, so the account
  // copy and the untouched shared home both exist.
  await mkdir(path.join(base, 'accounts', 'acct-1', 'sessions', 's1'), { recursive: true })
  await writeFile(path.join(base, 'accounts', 'acct-1', 'sessions', 's1', 'session.jsonl'), '{}')

  const home = await prepareAccountHome(base, 'acct-2')

  assert.equal(await exists(path.join(home, 'sessions')), false)
  assert.equal(await exists(path.join(base, 'sessions')), false)
  assert.equal(await exists(path.join(base, 'settings.yaml')), false)
})

test('an account with state of its own is not overwritten by the shared home', async () => {
  const base = await dshBaseWithLegacyState()
  const home = path.join(base, 'accounts', 'acct-1')
  await mkdir(path.join(home, 'sessions', 'own'), { recursive: true })
  await writeFile(path.join(home, 'sessions', 'own', 'session.jsonl'), '{}')

  await prepareAccountHome(base, 'acct-1')

  assert.equal(await exists(path.join(home, 'sessions', 'own', 'session.jsonl')), true)
  assert.equal(await exists(path.join(home, 'sessions', 's1')), false)
  assert.equal(await exists(path.join(base, 'sessions')), false)
})

test('a fresh install only creates the account home', async () => {
  const base = path.join(await mkdtemp(path.join(root, 'dsh-')), 'dsh')
  const home = await prepareAccountHome(base, 'acct-1')

  assert.deepEqual(await readdir(home), [])
})

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
