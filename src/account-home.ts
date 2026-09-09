import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Per-account DSH homes. Each account gets its own DSH_HOME under
 * <dshBase>/accounts/<accountId>, so sessions, settings and storages are fully
 * isolated between accounts.
 */
export function accountHomePath(dshBase: string, accountId: string): string {
  return path.join(dshBase, 'accounts', accountId)
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/**
 * One-time migration of the legacy shared home (pre-isolation layout) into the
 * given account home. Only user state is moved — sessions, storages and
 * settings.yaml. Credentials and runtime profiles are deliberately not copied:
 * old stored API keys must not follow the account, and DSH recreates its
 * profile on first boot. Runs at most once per account home (marker file).
 */
export async function migrateLegacyHomeOnce(dshBase: string, accountHome: string): Promise<void> {
  const marker = path.join(accountHome, '.legacy-migrated')
  if (await exists(marker)) return

  await mkdir(accountHome, { recursive: true })
  for (const entry of ['sessions', 'storages', 'settings.yaml'] as const) {
    const source = path.join(dshBase, entry)
    if (await exists(source)) {
      await cp(source, path.join(accountHome, entry), { recursive: true, force: true })
    }
  }
  await writeFile(marker, '')
}
