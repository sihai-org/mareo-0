import { readFile, writeFile } from 'node:fs/promises'

/**
 * Claims today's update prompt. A user who stays on an older version is
 * reminded once a day instead of on every launch, and the claim is recorded
 * before the prompt is shown so a quick restart cannot repeat it.
 */
export async function claimUpdatePrompt(statePath: string, date: string): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { lastPromptedOn?: unknown }
    if (state.lastPromptedOn === date) return false
  } catch {
    // No usable record yet: today's prompt is still available.
  }
  try {
    await writeFile(statePath, `${JSON.stringify({ lastPromptedOn: date })}\n`)
  } catch {
    // Failing to record the day is not worth skipping the prompt over.
  }
  return true
}
