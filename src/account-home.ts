import { access, mkdir, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

/** User state written before per-account homes existed. */
const LEGACY_ENTRIES = ['sessions', 'storages', 'settings.yaml'] as const

/**
 * Per-account DSH homes. Each account gets its own DSH_HOME under
 * <dshBase>/accounts/<accountId>, so sessions, settings and storages are fully
 * isolated between accounts.
 *
 * The pre-isolation shared home belongs to the first account that runs on this
 * machine after the upgrade: its state is moved — never copied — into that home,
 * so no account created later can see it. State still sitting in the shared home
 * while another account already exists is a leftover copy from an older build
 * and is deleted. Credentials are deliberately left behind: a stored API key
 * must not follow the account, and DSH recreates its profile on first boot.
 */
export async function prepareAccountHome(dshBase: string, accountId: string): Promise<string> {
  const home = path.join(dshBase, 'accounts', accountId)
  await mkdir(home, { recursive: true })

  const accounts = await readdir(path.join(dshBase, 'accounts'))
  const isFirstAccount = accounts.every((entry) => entry === accountId)

  for (const entry of LEGACY_ENTRIES) {
    const legacy = path.join(dshBase, entry)
    if (!(await exists(legacy))) continue
    const destination = path.join(home, entry)
    // An account that already has state of its own keeps it; the shared home is
    // stale by then and must not overwrite this account's data.
    if (isFirstAccount && !(await exists(destination))) {
      await rename(legacy, destination)
      continue
    }
    await rm(legacy, { recursive: true, force: true })
  }
  return home
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
