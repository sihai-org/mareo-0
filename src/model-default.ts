/**
 * The model an account starts on, migrated once.
 *
 * The engine's own default is the legacy `deepseek-v4-flash`, whose catalog
 * entry is declared text-only, so the read tool refuses images for every account
 * that never changed it — even though the provider serves that same model,
 * images included, under `deepseek-flash` ("DeepSeek-V41-Flash"). Both ids bill
 * at the Flash price, so moving the default to the official id unlocks image
 * input without changing cost or capability.
 *
 * This runs before the engine starts and is deliberately a one-time move: only
 * an absent default or the legacy id is rewritten. A model the user picked
 * afterwards — another Flash variant, Pro, anything — is left exactly as it is,
 * so choosing a model sticks.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_PROVIDER = 'deepseek-official'
export const DEFAULT_MODEL = 'deepseek-flash'

/** The engine's own default, which is text-only in the catalog. */
const LEGACY_MODEL = 'deepseek-v4-flash'

const SETTINGS_FILE = 'settings.yaml'
const SETTINGS_NAMESPACE = 'agent-default-model'
const MODEL_KEY = 'model'

/**
 * Moves the stored default model off the legacy id, leaving every other setting
 * — and every other key in the block, such as `reasoningEffort` — untouched.
 * Returns the input unchanged when there is nothing to move, so a launch does
 * not rewrite the file for nothing.
 */
export function withDefaultModel(document: string): string {
  const newline = document.includes('\r\n') ? '\r\n' : '\n'
  const lines = document.split(/\r?\n/)
  const header = lines.findIndex((line) => line.startsWith(`${SETTINGS_NAMESPACE}:`))

  if (header === -1) {
    const body = lines.filter((line, index) => !(index === lines.length - 1 && line === ''))
    return [...body, `${SETTINGS_NAMESPACE}:`, `  provider: ${DEFAULT_PROVIDER}`, `  ${MODEL_KEY}: ${DEFAULT_MODEL}`, ''].join(newline)
  }

  // The block runs while lines stay indented. An inline mapping lives on the
  // header line itself, and is edited in place rather than reformatted.
  let end = header + 1
  while (end < lines.length && /^[ \t]/.test(lines[end])) end += 1

  const inline = lines[header].slice(SETTINGS_NAMESPACE.length + 1).trim()
  if (inline !== '') {
    // Nothing to move unless that one line names the legacy model.
    if (!new RegExp(`\\b${MODEL_KEY}:\\s*${LEGACY_MODEL}\\b`).test(inline)) return document
    lines[header] = lines[header].replace(LEGACY_MODEL, DEFAULT_MODEL)
    return lines.join(newline)
  }

  for (let index = header + 1; index < end; index += 1) {
    const match = lines[index].match(/^([ \t]*model:\s*)(\S+)(.*)$/)
    if (match === null) continue
    // A model the account already uses: not ours to change.
    if (match[2] !== LEGACY_MODEL) return document
    lines[index] = `${match[1]}${DEFAULT_MODEL}${match[3]}`
    return lines.join(newline)
  }

  // A block with no model line at all still means "the engine's default", which
  // is the legacy id we are moving away from.
  lines.splice(end, 0, `  ${MODEL_KEY}: ${DEFAULT_MODEL}`)
  return lines.join(newline)
}

/** Applies the one-time move to an account's settings before the engine starts. */
export async function applyDefaultModel(dshHome: string): Promise<void> {
  const file = path.join(dshHome, SETTINGS_FILE)
  let document = ''
  try {
    document = await readFile(file, 'utf8')
  } catch {
    // No settings yet: the block below is the state a first launch starts from.
  }
  const updated = withDefaultModel(document)
  if (updated === document) return
  await mkdir(dshHome, { recursive: true })
  // Replace in one step: a half-written settings file would take the account's
  // whole configuration with it.
  const temporary = `${file}.mareo-tmp`
  await writeFile(temporary, updated)
  await rename(temporary, file)
}
