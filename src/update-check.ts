/**
 * Phase 1 update awareness: Mareo asks a static manifest whether a newer
 * release exists and points the user at the installer. Nothing is downloaded or
 * installed here — that is the later auto-update phase. A release may also
 * declare a minimum supported version, below which the app refuses to start.
 */
export interface ReleaseManifest {
  version: string
  releasedAt?: string
  notes?: string
  minimumVersion?: string
  downloads?: Partial<Record<'windows' | 'macos', string>>
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+].*)?$/

function parseVersion(version: string): { numbers: number[]; prerelease: string } {
  const [core, prerelease = ''] = version.replace(/^v/, '').split('-', 2)
  return { numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0), prerelease }
}

/** Standard semantic-version ordering; a release outranks its prereleases. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const x = a.numbers[index] ?? 0
    const y = b.numbers[index] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === '') return 1
  if (b.prerelease === '') return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/**
 * True when the release requires an update: the running build is older than the
 * manifest's minimum supported version. A malformed or absent minimum never
 * blocks anyone.
 */
export function isUpdateRequired(manifest: ReleaseManifest, currentVersion: string): boolean {
  return manifest.minimumVersion !== undefined && isNewerVersion(manifest.minimumVersion, currentVersion)
}

export interface UpdatePromptCopy {
  title: string
  message: string
  detail: string
  buttons: string[]
}

/**
 * Wording for the update prompt. When a release declares a minimum version, the
 * running build is already refused at startup — the prompt says so, even though
 * the session the user is in keeps working.
 */
export function updatePromptCopy(manifest: ReleaseManifest, currentVersion: string): UpdatePromptCopy {
  if (isUpdateRequired(manifest, currentVersion)) {
    return {
      title: `Mareo ${manifest.version} 必须更新`,
      message: `当前版本 ${currentVersion} 已不受支持，请更新到 ${manifest.version}。`,
      detail: `${manifest.notes ?? '新版本包含重要修复。'}\n\n可以先用完手头的事，但下次启动前必须完成更新。`,
      buttons: ['立即更新', '稍后'],
    }
  }
  return {
    title: `Mareo ${manifest.version} 已发布`,
    message: `你正在使用 ${currentVersion}，建议更新到 ${manifest.version}。`,
    detail: manifest.notes ?? '新版本包含功能改进与问题修复。',
    buttons: ['前往下载', '明天再提醒'],
  }
}

export function parseReleaseManifest(raw: unknown): ReleaseManifest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.version !== 'string' || !VERSION_PATTERN.test(record.version)) return undefined

  const manifest: ReleaseManifest = { version: record.version }
  if (typeof record.releasedAt === 'string') manifest.releasedAt = record.releasedAt
  if (typeof record.notes === 'string') manifest.notes = record.notes
  if (typeof record.minimumVersion === 'string' && VERSION_PATTERN.test(record.minimumVersion)) {
    manifest.minimumVersion = record.minimumVersion
  }

  const downloads = record.downloads
  if (typeof downloads === 'object' && downloads !== null) {
    const entries = downloads as Record<string, unknown>
    const parsed: ReleaseManifest['downloads'] = {}
    for (const key of ['windows', 'macos'] as const) {
      const value = entries[key]
      if (typeof value === 'string' && value !== '') parsed[key] = value
    }
    if (Object.keys(parsed).length > 0) manifest.downloads = parsed
  }
  return manifest
}

export function selectDownloadUrl(
  manifest: ReleaseManifest,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const key = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : undefined
  return key === undefined ? undefined : manifest.downloads?.[key]
}

export interface FetchOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Resolves the manifest, or undefined on any failure (never throws). */
export async function fetchLatestRelease(url: string, options: FetchOptions = {}): Promise<ReleaseManifest | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 5_000) })
    if (!response.ok) return undefined
    return parseReleaseManifest(await response.json())
  } catch {
    return undefined
  }
}
