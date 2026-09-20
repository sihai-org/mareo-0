/**
 * The model every account starts on.
 *
 * Mareo pins it because image reading depends on it: the engine's catalog still
 * ships `deepseek-v4-flash` as a legacy entry declared text-only, while the
 * provider serves that same model under the official id `deepseek-flash`
 * ("DeepSeek-V41-Flash"), whose catalog entry accepts images. Both ids reach the
 * same model at the same price, so pinning the official one costs nothing and
 * unlocks image input.
 *
 * The setting is rewritten on every launch, which also overrides a model chosen
 * in a previous session. That is deliberate — the product decides the default
 * instead of letting it drift per machine — and relaxing it would mean skipping
 * the write when the stored value is one we did not set.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_PROVIDER = 'deepseek-official'
export const DEFAULT_MODEL = 'deepseek-flash'

const SETTINGS_FILE = 'settings.yaml'
const SETTINGS_NAMESPACE = 'agent-default-model'

/** Values the block must carry, in the order we write them. */
const REQUIRED: [string, string][] = [
  ['provider', DEFAULT_PROVIDER],
  ['model', DEFAULT_MODEL],
]

/**
 * Rewrites the `agent-default-model` settings block, keeping every other
 * setting (and every other key inside the block, such as `reasoningEffort`)
 * exactly as it was. Returns the input unchanged when it is already correct, so
 * a launch does not rewrite the file for nothing.
 */
export function withDefaultModel(document: string): string {
  const newline = document.includes('\r\n') ? '\r\n' : '\n'
  const lines = document.split(/\r?\n/)
  const header = lines.findIndex((line) => line.startsWith(`${SETTINGS_NAMESPACE}:`))

  if (header === -1) {
    const body = lines.filter((line, index) => !(index === lines.length - 1 && line === ''))
    return [...body, ...blockLines([]), ''].join(newline)
  }

  // The block runs while lines stay indented; an inline mapping (`{...}`) is a
  // one-line block and is rewritten in block form.
  let end = header + 1
  while (end < lines.length && /^[ \t]/.test(lines[end])) end += 1
  const existing = lines.slice(header + 1, end)
  const inline = lines[header].slice(`${SETTINGS_NAMESPACE}:`.length).trim()
  const kept = [...(inline === '' ? [] : inlinePairs(inline)), ...existing.filter((line) => !isRequired(line))]
  const block = blockLines(kept)
  if ([lines[header], ...existing].join(newline) === block.join(newline)) return document
  return [...lines.slice(0, header), ...block, ...lines.slice(end)].join(newline)
}

/** Writes the pinned default into an account's settings before the engine starts. */
export async function applyDefaultModel(dshHome: string): Promise<void> {
  const file = path.join(dshHome, SETTINGS_FILE)
  let document = ''
  try {
    document = await readFile(file, 'utf8')
  } catch {
    // No settings yet: the block we are about to write is the engine's defaults
    // plus our model, which is exactly the state a first launch starts from.
  }
  const updated = withDefaultModel(document)
  if (updated === document) return
  await mkdir(dshHome, { recursive: true })
  // Replace the file in one step: a half-written settings file would take the
  // account's whole configuration with it.
  const temporary = `${file}.mareo-tmp`
  await writeFile(temporary, updated)
  await rename(temporary, file)
}

function blockLines(kept: string[]): string[] {
  return [`${SETTINGS_NAMESPACE}:`, ...REQUIRED.map(([key, value]) => `  ${key}: ${value}`), ...kept]
}

function isRequired(line: string): boolean {
  return REQUIRED.some(([key]) => new RegExp(`^[ \\t]+${key}:`).test(line))
}

/** `{provider: deepseek-official, reasoningEffort: high}` → block lines. */
function inlinePairs(inline: string): string[] {
  const inner = inline.replace(/^\{/, '').replace(/\}$/, '')
  return inner
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
    .map((pair) => {
      const separator = pair.indexOf(':')
      const key = separator === -1 ? pair : pair.slice(0, separator).trim()
      const value = separator === -1 ? '' : pair.slice(separator + 1).trim()
      return `  ${key}: ${value}`
    })
    .filter((line) => !isRequired(line))
}
