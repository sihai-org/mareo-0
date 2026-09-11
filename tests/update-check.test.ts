import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareVersions,
  fetchLatestRelease,
  isNewerVersion,
  parseReleaseManifest,
  selectDownloadUrl,
} from '../src/update-check.js'

test('orders release versions and their prereleases', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('v0.1.2', '0.1.1'), 1)
  assert.equal(compareVersions('0.1.1-rc.1', '0.1.1'), -1)
  assert.equal(compareVersions('0.1.1-rc.2', '0.1.1-rc.1'), 1)

  assert.equal(isNewerVersion('0.1.1', '0.1.0'), true)
  assert.equal(isNewerVersion('0.1.0', '0.1.0'), false)
  assert.equal(isNewerVersion('0.1.0', '0.1.1'), false)
})

test('parses a well-formed manifest and rejects junk', () => {
  const manifest = parseReleaseManifest({
    version: '0.1.1',
    releasedAt: '2026-09-12T10:00:00Z',
    notes: '修复 Windows 菜单栏',
    downloads: { windows: 'https://mareo.cn/downloads/MareoSetup.exe', macos: '', other: 'x' },
  })
  assert.deepEqual(manifest, {
    version: '0.1.1',
    releasedAt: '2026-09-12T10:00:00Z',
    notes: '修复 Windows 菜单栏',
    downloads: { windows: 'https://mareo.cn/downloads/MareoSetup.exe' },
  })

  assert.equal(parseReleaseManifest(null), undefined)
  assert.equal(parseReleaseManifest({ version: 'next' }), undefined)
  assert.equal(parseReleaseManifest({ downloads: {} }), undefined)
})

test('picks the download for the running platform', () => {
  const manifest = parseReleaseManifest({
    version: '0.1.1',
    downloads: { windows: 'https://mareo.cn/w.exe', macos: 'https://mareo.cn/m.dmg' },
  })!
  assert.equal(selectDownloadUrl(manifest, 'win32'), 'https://mareo.cn/w.exe')
  assert.equal(selectDownloadUrl(manifest, 'darwin'), 'https://mareo.cn/m.dmg')
  assert.equal(selectDownloadUrl(manifest, 'linux'), undefined)
  assert.equal(selectDownloadUrl({ version: '0.1.1' }, 'win32'), undefined)
})

test('update checks stay silent when the network or payload misbehaves', async () => {
  const ok = await fetchLatestRelease('https://example.test/latest.json', {
    fetchImpl: (async () => ({ ok: true, json: async () => ({ version: '0.1.1' }) })) as unknown as typeof fetch,
  })
  assert.deepEqual(ok, { version: '0.1.1' })

  const missing = await fetchLatestRelease('https://example.test/latest.json', {
    fetchImpl: (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
  })
  assert.equal(missing, undefined)

  const broken = await fetchLatestRelease('https://example.test/latest.json', {
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch,
  })
  assert.equal(broken, undefined)

  const garbage = await fetchLatestRelease('https://example.test/latest.json', {
    fetchImpl: (async () => ({ ok: true, json: async () => ({ nope: true }) })) as unknown as typeof fetch,
  })
  assert.equal(garbage, undefined)
})
