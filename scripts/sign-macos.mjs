// Sign and notarize the packaged Mareo.app for outside-the-App-Store
// distribution (Developer ID + notarytool). Runs as a Forge postPackage hook.
//
// Behaviour is opt-in so a plain `npm run make` keeps producing the unsigned
// beta DMG:
//   - signing runs only when a "Developer ID Application" identity is found
//     (or CSC_NAME points at one);
//   - notarization + stapling runs only when APPLE_ID,
//     APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are all set.
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const { signAsync } = require('@electron/osx-sign')

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function findDeveloperIdIdentity() {
  const { stdout } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning'])
  const line = stdout.split('\n').find((entry) => entry.includes('Developer ID Application'))
  const match = line?.match(/"([^"]+)"/)
  return match?.[1]
}

export async function signApp(appPath) {
  const identity = process.env.CSC_NAME ?? (await findDeveloperIdIdentity())
  if (!identity) {
    console.warn('[sign-macos] No "Developer ID Application" identity found — skipping signing.')
    return false
  }
  console.log(`[sign-macos] Signing ${appPath} as "${identity}"`)
  await signAsync({
    app: appPath,
    identity,
    hardenedRuntime: true,
    entitlements: path.join(projectRoot, 'entitlements.mac.plist'),
  })
  return true
}

export async function notarizeApp(appPath) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.warn('[sign-macos] Notarization credentials missing (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID) — skipping notarization.')
    return false
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'mareo-notarize-'))
  try {
    const zip = path.join(temporary, 'Mareo.zip')
    await execFileAsync('ditto', ['-c', '-k', '--sequester-rsrc', '--keepParent', appPath, zip])
    await execFileAsync('xcrun', [
      'notarytool', 'submit', zip,
      '--apple-id', APPLE_ID,
      '--password', APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id', APPLE_TEAM_ID,
      '--wait',
    ])
    await execFileAsync('xcrun', ['stapler', 'staple', appPath])
    console.log('[sign-macos] Notarized and stapled.')
    return true
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

// Direct run: node scripts/sign-macos.mjs /path/to/Mareo.app
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appPath = process.argv[2]
  if (!appPath) {
    console.error('usage: node scripts/sign-macos.mjs <path-to-Mareo.app>')
    process.exit(1)
  }
  if (await signApp(appPath)) await notarizeApp(appPath)
}
