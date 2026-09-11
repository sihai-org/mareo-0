// Builds updates/latest.json for a release from the packaged artifacts.
// Usage:
//   node scripts/generate-release-manifest.mjs \
//     --version 0.1.1 --base https://dl.mareo.cn \
//     --macos Mareo-0.1.1-macos-arm64.dmg \
//     --windows Mareo-0.1.1-windows-x64-setup.exe \
//     [--notes "修复 Windows 菜单栏"] [--out updates/latest.json]
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export function buildReleaseManifest({ version, baseUrl, macos, windows, notes, releasedAt }) {
  if (!/^\d+\.\d+\.\d+/.test(version ?? '')) throw new Error(`Invalid version: ${version}`)
  const base = baseUrl.replace(/\/+$/, '')
  const downloads = {}
  if (macos) downloads.macos = `${base}/${macos}`
  if (windows) downloads.windows = `${base}/${windows}`
  const manifest = { version, releasedAt: releasedAt ?? new Date().toISOString() }
  if (notes) manifest.notes = notes
  if (Object.keys(downloads).length > 0) manifest.downloads = downloads
  return manifest
}

export function parseArguments(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  return {
    version: value('--version'),
    baseUrl: value('--base') ?? 'https://mareo.cn/downloads',
    macos: value('--macos'),
    windows: value('--windows'),
    notes: value('--notes'),
    out: value('--out'),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const options = parseArguments(process.argv.slice(2))
  const manifest = buildReleaseManifest(options)
  const output = options.out ?? 'updates/latest.json'
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${output}: ${JSON.stringify(manifest)}`)
}
