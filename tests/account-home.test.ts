import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { accountHomePath, migrateLegacyHomeOnce } from '../src/account-home.js'

let directory: string
let dshBase: string

test.before(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'mareo-account-home-'))
  dshBase = path.join(directory, 'dsh')
  // A legacy shared home with user state to migrate.
  mkdirSync(path.join(dshBase, 'sessions', 's1'), { recursive: true })
  writeFileSync(path.join(dshBase, 'sessions', 's1', 'session.jsonl'), '{}')
  mkdirSync(path.join(dshBase, 'storages'))
  writeFileSync(path.join(dshBase, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: x\n')
  // Credentials must never follow an account migration.
  writeFileSync(path.join(dshBase, '.credentials.yaml'), 'secret')
})

test.after(() => {
  rmSync(directory, { recursive: true, force: true })
})

test('migrates user state once into the per-account home and skips credentials', async () => {
  const accountHome = accountHomePath(dshBase, 'acct-1')
  await migrateLegacyHomeOnce(dshBase, accountHome)

  assert.equal(accountHome, path.join(dshBase, 'accounts', 'acct-1'))
  assert.equal(await exists(accountHome), true)
  assert.equal(await exists(path.join(accountHome, 'sessions', 's1', 'session.jsonl')), true)
  assert.equal(await exists(path.join(accountHome, 'storages')), true)
  assert.equal(await exists(path.join(accountHome, 'settings.yaml')), true)
  // Credentials are left behind on purpose.
  assert.equal(await exists(path.join(accountHome, '.credentials.yaml')), false)

  // A second call is a no-op (marker), and other accounts are isolated.
  await migrateLegacyHomeOnce(dshBase, accountHome)
  const otherHome = accountHomePath(dshBase, 'acct-2')
  await migrateLegacyHomeOnce(dshBase, otherHome)
  assert.equal(await exists(path.join(otherHome, 'sessions', 's1', 'session.jsonl')), true)
})

test('does nothing when there is no legacy state', async () => {
  const emptyBase = path.join(directory, 'empty-dsh')
  const home = accountHomePath(emptyBase, 'acct-x')
  await migrateLegacyHomeOnce(emptyBase, home)
  assert.equal(await exists(home), true)
  assert.equal(await exists(path.join(home, '.legacy-migrated')), true)
})

async function exists(target: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((fs) => fs.access(target))
    return true
  } catch {
    return false
  }
}
