import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadPreferences, preferencesPath, savePreferences } from '../src/preferences.js'
import { stripLocalPaths, Telemetry } from '../src/telemetry.js'

let root: string

test.before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mareo-telemetry-'))
})

test.after(async () => {
  await rm(root, { recursive: true, force: true })
})

interface SentRequest {
  url: string
  body: { events: { name: string; version: string; platform: string; detail?: string }[] }
  authorization?: string
}

function recordingFetch(sent: SentRequest[], ok = true): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as SentRequest['body'],
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
    })
    return { ok } as Response
  }) as unknown as typeof fetch
}

test('sends events with version and platform, and no extra fields', async () => {
  const sent: SentRequest[] = []
  const telemetry = new Telemetry({
    endpoint: 'https://gateway.test/events',
    version: '0.1.3',
    enabled: true,
    fetchImpl: recordingFetch(sent),
  })

  telemetry.record({ name: 'launch', detail: { ok: true, ms: 1200 } })
  await telemetry.flush()

  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://gateway.test/events')
  assert.deepEqual(sent[0].body.events, [
    { name: 'launch', version: '0.1.3', platform: process.platform, detail: '{"ok":true,"ms":1200}' },
  ])
  assert.equal(sent[0].authorization, undefined)
})

test('attaches the account token once signed in', async () => {
  const sent: SentRequest[] = []
  const telemetry = new Telemetry({
    endpoint: 'https://gateway.test/events',
    version: '0.1.3',
    enabled: true,
    fetchImpl: recordingFetch(sent),
  })
  telemetry.setToken('secret-token')

  await telemetry.sendNow({ name: 'install_confirmed' })

  assert.equal(sent[0].authorization, 'Bearer secret-token')
  assert.deepEqual(sent[0].body.events, [{ name: 'install_confirmed', version: '0.1.3', platform: process.platform }])
})

test('sends nothing when statistics are off', async () => {
  const sent: SentRequest[] = []
  const telemetry = new Telemetry({
    endpoint: 'https://gateway.test/events',
    version: '0.1.3',
    enabled: true,
    fetchImpl: recordingFetch(sent),
  })
  telemetry.record({ name: 'launch' })
  await telemetry.flush()
  assert.equal(sent.length, 1)

  telemetry.setEnabled(false)
  telemetry.record({ name: 'launch' })
  assert.equal(await telemetry.flush(), undefined)
  assert.equal(await telemetry.sendNow({ name: 'install_confirmed' }), false)
  assert.equal(sent.length, 1)
})

test('a failed send is dropped and reported to the caller', async () => {
  const telemetry = new Telemetry({
    endpoint: 'https://gateway.test/events',
    version: '0.1.3',
    enabled: true,
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch,
  })

  assert.equal(await telemetry.sendNow({ name: 'install_confirmed' }), false)
  telemetry.record({ name: 'launch' })
  await telemetry.flush()
})

test('truncates detail so nothing long can be smuggled in', async () => {
  const sent: SentRequest[] = []
  const telemetry = new Telemetry({
    endpoint: 'https://gateway.test/events',
    version: '0.1.3',
    enabled: true,
    fetchImpl: recordingFetch(sent),
  })

  await telemetry.sendNow({ name: 'harness_exit', detail: { error: 'x'.repeat(900) } })
  assert.equal(sent[0].body.events[0].detail?.length, 500)
})

test('reported errors keep local paths — and the user name in them — out', () => {
  assert.equal(
    stripLocalPaths(
      "ENOENT: no such file or directory, open '/Users/zhefeng/Library/Application Support/Mareo/dsh/accounts/x/mareo.log'",
    ),
    'ENOENT: no such file or directory, open \'<path>\'',
  )
  // Ordinary messages are untouched.
  assert.equal(
    stripLocalPaths('DeepSeek Harness exited unexpectedly (code 1).'),
    'DeepSeek Harness exited unexpectedly (code 1).',
  )
  assert.equal(
    stripLocalPaths('Timed out waiting for DeepSeek Harness to report its local address.'),
    'Timed out waiting for DeepSeek Harness to report its local address.',
  )
  assert.equal(stripLocalPaths('/Users/zhefeng/Mareo/logs/mareo.log'), '<path>')
  assert.equal(stripLocalPaths('x'.repeat(400)).length, 200)
})

test('preferences default to on, persist, and survive junk', async () => {
  const userData = path.join(root, 'user-data')
  await mkdir(userData, { recursive: true })

  assert.deepEqual(await loadPreferences(userData), { telemetry: true })

  await savePreferences(userData, { telemetry: false })
  assert.deepEqual(await loadPreferences(userData), { telemetry: false })
  assert.match(await readFile(preferencesPath(userData), 'utf8'), /"telemetry": false/)

  await writeFile(preferencesPath(userData), '{ broken')
  assert.deepEqual(await loadPreferences(userData), { telemetry: true })

  await writeFile(preferencesPath(userData), '{"telemetry":"yes"}')
  assert.deepEqual(await loadPreferences(userData), { telemetry: true })
})
