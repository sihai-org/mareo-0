// Counts real downloads from Aliyun OSS access logs, so the install-success
// metric has a denominator: the gateway never sees a download, only the client's
// first successful launch.
//
//   npm run downloads:oss                 # 最近 7 天
//   npm run downloads:oss -- --days 30
//
// Credentials come from OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET
// (see .env.oss, which is git-ignored). OSS delivers access logs hourly, so the
// current hour shows up late — an empty result usually just means "not yet".
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const DEFAULT_PREFIX = 'oss-accesslog/'
const DEFAULT_DAYS = 7

/**
 * Release artifacts we care about. Versioned installers carry a platform+variant
 * in the middle ("Mareo-0.1.3-windows-x64-setup.exe"), so only the prefix and the
 * extension are pinned; fixed-name objects are listed explicitly.
 */
const ARTIFACT_PATTERN = /(Mareo-[\w.-]+\.(?:dmg|exe|nupkg|zip)|MareoSetup\.exe|RELEASES|app-icon\.ico|latest\.json)$/

/** Splits an OSS access-log line into fields, honouring quoted fields. */
export function splitLogFields(line) {
  const fields = []
  let current = ''
  let quoted = false
  for (const character of line.trim()) {
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (character === ' ' || character === '\t')) {
      if (current !== '') fields.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current !== '') fields.push(current)
  return fields
}

/**
 * Aliyun access logs are nginx-shaped with the OSS fields appended at the end:
 *
 *   <ip> - - [<time>] "<request>" <status> <bytes> … "<host>" … "<requester>"
 *   "<operation>" "<bucket>" "<key>" <object-size> …
 *
 * so the object key sits two fields after the operation (the bucket is in
 * between) and the status is the field right after the request. Only a
 * successful GetObject for a release artifact counts as a download; listings,
 * HEADs, misses and the log delivery itself are ignored.
 */
export function parseDownloadLine(line) {
  const fields = splitLogFields(line)
  const operationIndex = fields.indexOf('GetObject')
  if (operationIndex < 0) return undefined
  const key = fields[operationIndex + 2]
  if (key === undefined) return undefined
  const artifact = ARTIFACT_PATTERN.exec(key)?.[1]
  if (artifact === undefined) return undefined
  const requestIndex = fields.findIndex((field) => /^[A-Z]+ \S+ HTTP\//.test(field))
  const status = requestIndex < 0 ? undefined : fields[requestIndex + 1]
  return { artifact, status: status !== undefined && /^[1-5]\d\d$/.test(status) ? Number(status) : 0 }
}

/** Installers are the denominator for the install-success rate. */
export function isInstaller(artifact) {
  return /\.(dmg|exe)$/.test(artifact)
}

export function summarizeDownloads(lines) {
  const succeeded = new Map()
  const failed = new Map()
  for (const line of lines) {
    const parsed = parseDownloadLine(line)
    if (parsed === undefined) continue
    const target = parsed.status === 200 ? succeeded : failed
    target.set(parsed.artifact, (target.get(parsed.artifact) ?? 0) + 1)
  }
  const installerTotal = [...succeeded].filter(([artifact]) => isInstaller(artifact)).reduce((sum, [, n]) => sum + n, 0)
  return { succeeded, failed, installerTotal }
}

export function parseArguments(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const prefix = value('--prefix') ?? DEFAULT_PREFIX
  const days = Number.parseInt(value('--days') ?? String(DEFAULT_DAYS), 10)
  return { prefix, days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS }
}

async function listLogObjects(client, prefix, since) {
  const names = []
  let marker
  do {
    const result = await client.list({ prefix, 'max-keys': 1000, marker }, {})
    for (const object of result.objects ?? []) {
      if (new Date(object.lastModified) >= since) names.push(object.name)
    }
    marker = result.nextMarker
  } while (marker !== undefined && marker !== null && marker !== '')
  return names
}

async function main() {
  const configuration = {
    region: process.env.OSS_REGION,
    // Logs belong in their own private bucket; the artifact bucket is public-read.
    bucket: process.env.OSS_LOG_BUCKET ?? process.env.OSS_BUCKET,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  }
  if (Object.values(configuration).some((value) => value === undefined)) {
    console.error(
      '需要 OSS_REGION / (OSS_LOG_BUCKET 或 OSS_BUCKET) / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（见 .env.oss）',
    )
    process.exit(1)
  }
  const { prefix, days } = parseArguments(process.argv.slice(2))
  const OSS = require('ali-oss')
  const client = new OSS(configuration)

  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const names = await listLogObjects(client, prefix, since)
  console.log(`# OSS 下载统计（前缀 ${prefix}，最近 ${days} 天，共 ${names.length} 个日志对象）\n`)
  if (names.length === 0) {
    console.log('暂无日志对象。OSS 按小时投递访问日志，刚开启或该时段没有请求时会是空的；')
    console.log('另外只有真实下载（GetObject）才会被记录，官网点击下载后经 mareo.cn 302 也会落到这里。')
    return
  }

  const lines = []
  for (const name of names) {
    const { content } = await client.get(name, { timeout: 60_000 })
    lines.push(...content.toString('utf8').split('\n'))
  }

  const { succeeded, failed, installerTotal } = summarizeDownloads(lines)
  if (succeeded.size === 0) {
    console.log(`扫描了 ${lines.length} 行日志，但没有匹配到我们的安装包下载。`)
    console.log('若确实有下载发生，说明日志字段格式与预期不同，需要按实际样例调整解析。')
    console.log(`前 3 行样例：\n${lines.filter((line) => line.trim() !== '').slice(0, 3).join('\n')}`)
    return
  }

  console.log('安装包下载（HTTP 200 的 GetObject）：')
  for (const [artifact, count] of [...succeeded].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${artifact.padEnd(40)} ${count}${isInstaller(artifact) ? '' : '   （非安装包，不计入分母）'}`)
  }
  if (failed.size > 0) {
    console.log('\n失败的下载请求：')
    for (const [artifact, count] of failed) console.log(`  ${artifact.padEnd(40)} ${count}`)
  }
  console.log(`\n安装包下载合计：${installerTotal}`)
  console.log(`→ npm run --prefix server metrics -- --downloads ${installerTotal}`)
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await main()
}
