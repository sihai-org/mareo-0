import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

interface ReleaseManifest {
  version: string
  releasedAt: string
  notes?: string
  minimumVersion?: string
  downloads?: Partial<Record<'macos' | 'windows', string>>
}

interface ManifestInput {
  version: string
  baseUrl: string
  macos?: string
  windows?: string
  notes?: string
  minimumVersion?: string
  releasedAt?: string
}

interface ManifestModule {
  buildReleaseManifest(input: ManifestInput): ReleaseManifest
  parseArguments(argv: string[]): ManifestInput
}

async function manifestModule(): Promise<ManifestModule> {
  // Resolved at runtime so the compiled test finds the script regardless of
  // where the build output lives.
  const script = pathToFileURL(path.resolve('scripts/generate-release-manifest.mjs')).href
  return (await import(script)) as ManifestModule
}

test('builds a manifest with absolute download URLs', async () => {
  const { buildReleaseManifest } = await manifestModule()
  const ossBase = 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com'
  const manifest = buildReleaseManifest({
    version: '0.1.1',
    baseUrl: `${ossBase}/`,
    macos: 'Mareo-0.1.1-macos-arm64.dmg',
    windows: 'Mareo-0.1.1-windows-x64-setup.exe',
    notes: '修复 Windows 菜单栏',
    releasedAt: '2026-09-12T00:00:00.000Z',
  })
  assert.deepEqual(manifest, {
    version: '0.1.1',
    releasedAt: '2026-09-12T00:00:00.000Z',
    notes: '修复 Windows 菜单栏',
    downloads: {
      macos: `${ossBase}/Mareo-0.1.1-macos-arm64.dmg`,
      windows: `${ossBase}/Mareo-0.1.1-windows-x64-setup.exe`,
    },
  })
})

test('omits platforms that were not built and defaults the timestamp', async () => {
  const { buildReleaseManifest } = await manifestModule()
  const manifest = buildReleaseManifest({ version: '0.2.0', baseUrl: 'https://mareo.cn/downloads', macos: 'm.dmg' })
  assert.deepEqual(Object.keys(manifest.downloads ?? {}), ['macos'])
  assert.ok(!Number.isNaN(Date.parse(manifest.releasedAt)))
})

test('rejects a version that is not semantic', async () => {
  const { buildReleaseManifest } = await manifestModule()
  assert.throws(() => buildReleaseManifest({ version: 'latest', baseUrl: 'https://x' }), /Invalid version/)
})

test('carries a minimum version only when the release sets one', async () => {
  const { buildReleaseManifest } = await manifestModule()
  const forced = buildReleaseManifest({
    version: '0.2.0',
    baseUrl: 'https://mareo.cn/downloads',
    macos: 'm.dmg',
    minimumVersion: '0.2.0',
  })
  assert.equal(forced.minimumVersion, '0.2.0')

  const optional = buildReleaseManifest({
    version: '0.2.0',
    baseUrl: 'https://mareo.cn/downloads',
    macos: 'm.dmg',
    minimumVersion: '',
  })
  assert.equal('minimumVersion' in optional, false)

  assert.throws(() => buildReleaseManifest({ version: '0.2.0', baseUrl: 'https://x', minimumVersion: 'newest' }))
})

test('parses release arguments with a default base URL', async () => {
  const { parseArguments } = await manifestModule()
  const options = parseArguments(['--version', '0.1.1', '--windows', 'w.exe', '--notes', 'hi'])
  assert.equal(options.version, '0.1.1')
  assert.equal(options.windows, 'w.exe')
  assert.equal(options.notes, 'hi')
  assert.equal(options.baseUrl, 'https://mareo.cn/downloads')
})
