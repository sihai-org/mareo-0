import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** User-facing application preferences (not account state). */
export interface Preferences {
  /** Anonymous operational statistics: installs, launches, crashes, sign-in results. */
  telemetry: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { telemetry: true }

export function preferencesPath(userDataPath: string): string {
  return path.join(userDataPath, 'preferences.json')
}

/** Never throws: an unreadable or malformed file falls back to the defaults. */
export async function loadPreferences(userDataPath: string): Promise<Preferences> {
  try {
    const raw = JSON.parse(await readFile(preferencesPath(userDataPath), 'utf8')) as { telemetry?: unknown }
    return { telemetry: typeof raw.telemetry === 'boolean' ? raw.telemetry : DEFAULT_PREFERENCES.telemetry }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export async function savePreferences(userDataPath: string, preferences: Preferences): Promise<void> {
  await writeFile(preferencesPath(userDataPath), `${JSON.stringify(preferences, null, 2)}\n`)
}
