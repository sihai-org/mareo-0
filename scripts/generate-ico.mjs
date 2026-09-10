// Builds assets/app-icon.ico (multi-size Windows icon) from assets/app-icon.png.
// Run on macOS, which has `sips` for resizing; the generated .ico is committed
// so normal builds and Windows machines never need this tooling.
//
//   node scripts/generate-ico.mjs
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePng = path.join(projectDirectory, 'assets', 'app-icon.png')
const targetIco = path.join(projectDirectory, 'assets', 'app-icon.ico')
const sizes = [16, 32, 48, 64, 128, 256]

const { default: pngToIco } = await import('png-to-ico')
const workDirectory = await mkdtemp(path.join(tmpdir(), 'mareo-ico-'))
try {
  const resized = []
  for (const size of sizes) {
    const output = path.join(workDirectory, `icon-${size}.png`)
    await execFileAsync('sips', ['-z', String(size), String(size), sourcePng, '--out', output], { stdio: 'ignore' })
    resized.push(output)
  }
  const ico = await pngToIco(resized)
  await writeFile(targetIco, ico)
  const header = await readFile(targetIco)
  console.log(`Wrote ${targetIco} (${header.length} bytes, ${header.readUInt16LE(4)} images)`)
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
