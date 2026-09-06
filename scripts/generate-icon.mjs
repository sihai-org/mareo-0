import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const iconset = path.join(root, '.cache', 'icons', 'mareo.iconset')
await mkdir(iconset, { recursive: true })

for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', [
      '-z', String(size * scale), String(size * scale),
      path.join(root, 'assets', 'logo-white.png'),
      '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
    ])
  }
}

execFileSync('/usr/bin/iconutil', [
  '-c', 'icns', iconset, '-o', path.join(root, '.cache', 'icons', 'mareo.icns'),
])
