// One-command release: build (sign + notarize) the DMG, upload it and sync the
// official website. Usage:
//
//   npm run release            # everything, interactive confirmations optional
//   npm run release -- --no-upload   # build + verify locally only
//
// Config comes from the environment; a git-ignored `.release.env` file in the
// repo root (see scripts/release.env.example) is loaded first, so secrets never
// need to live in your shell history.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const dmgName = `Mareo-${packageJson.version}-macos-arm64.dmg`
const appPath = path.join(projectRoot, 'out', 'Mareo-darwin-arm64', 'Mareo.app')
const dmgPath = path.join(projectRoot, 'out', 'make', dmgName)

const noUpload = process.argv.includes('--no-upload')

// ---- load .release.env (repo root, git-ignored) into the environment ----
function loadEnvFile() {
  const file = path.join(projectRoot, '.release.env')
  if (!existsSync(file)) return
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim()
  }
}

function required(name) {
  if (!process.env[name]) {
    console.error(`[release] Missing ${name}. Copy scripts/release.env.example to .release.env and fill it in.`)
    process.exit(1)
  }
  return process.env[name]
}

function step(message) {
  console.log(`\n==> ${message}`)
}

async function run(command, args, { env } = {}) {
  await execFileAsync(command, args, { env: { ...process.env, ...env } })
}

// ---- steps ----
loadEnvFile()
if (!process.env.ELECTRON_MIRROR) process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
const appleId = required('APPLE_ID')
const applePassword = required('APPLE_APP_SPECIFIC_PASSWORD')
const teamId = required('APPLE_TEAM_ID')

step('检查 Developer ID 证书')
const { stdout: identities } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning'])
if (!identities.includes('Developer ID Application')) {
  console.error('[release] No "Developer ID Application" certificate found in the keychain.')
  process.exit(1)
}

step('打包（签名 + 公证） npm run make')
await new Promise((resolve, reject) => {
  const child = spawn('npm', ['run', 'make'], { cwd: projectRoot, stdio: 'inherit', env: process.env })
  child.once('error', reject)
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm run make exited with code ${code}`))))
})

if (!existsSync(appPath) || !existsSync(dmgPath)) {
  console.error(`[release] Expected artifacts missing:\n  ${appPath}\n  ${dmgPath}`)
  process.exit(1)
}

step('验证签名与公证')
await run('codesign', ['--verify', '--deep', '--strict', appPath])
await run('xcrun', ['stapler', 'validate', appPath])
const { stdout: spctlOut } = await execFileAsync('spctl', ['-a', '-t', 'exec', '-vv', appPath])
console.log('  ' + spctlOut.split('\n')[0])

const { stdout: shaOut } = await execFileAsync('shasum', ['-a', '256', dmgPath])
const sha256 = shaOut.split(/\s+/)[0]
console.log(`  sha256: ${sha256}`)

if (noUpload) {
  console.log(`\n[release] done (local). DMG: ${dmgPath}`)
  process.exit(0)
}

// ---- upload & publish ----
const server = required('SERVER') // e.g. root@114.55.15.112
const sshKey = required('SSH_KEY') // e.g. /Users/zhefeng/.ssh/mareo-0.pem
const remoteDmgDir = required('REMOTE_DMG_DIR')
const remoteWebDir = required('REMOTE_WEB_DIR')
const siteUrl = process.env.SITE_URL ?? 'https://mareo.cn' // public site origin hosting /downloads/
const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes']

step(`上传 ${dmgName} -> ${server}:${remoteDmgDir}/`)
const tmpDmg = `${remoteDmgDir}/.${dmgName}.uploading`
await run('scp', [...sshArgs, dmgPath, `${server}:${tmpDmg}`])
await run('ssh', [...sshArgs, server, `mv -f ${tmpDmg} ${remoteDmgDir}/${dmgName}`])

step(`同步官网文件 -> ${server}:${remoteWebDir}/`)
for (const entry of ['index.html', 'styles.css', 'app.js', 'assets']) {
  const local = path.join(projectRoot, 'website', entry)
  await run('scp', ['-r', ...sshArgs, local, `${server}:${remoteWebDir}/`])
}

step('验证线上下载')
const { stdout: headOut } = await execFileAsync('curl', ['-sI', '-m', '20', `${siteUrl}/downloads/${dmgName}`])
const statusLine = headOut.split('\n').find((line) => line.startsWith('HTTP/'))?.trim()
if (!statusLine?.includes('200')) {
  console.error(`[release] Download check failed: ${statusLine ?? headOut.split('\n')[0]}`)
  process.exit(1)
}

console.log(`\n[release] 发布完成 ✔`)
console.log(`  DMG   : ${dmgPath}`)
console.log(`  sha256: ${sha256}`)
console.log(`  URL   : ${siteUrl}/downloads/${dmgName}`)
if (packageJson.version !== '0.1.0') {
  console.log(`\n[release] 提示：版本号已变化，请确认 website/app.js 的 downloadUrl 指向 ${dmgName}（下载文件名由 package.json 版本决定）。`)
}
