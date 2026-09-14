// Prints the launch-quality metrics the client and gateway can actually answer:
//
//   npm run metrics                      # 用默认数据库路径
//   npm run metrics -- --downloads 137   # 带上下载次数，算安装成功率
//
// Definitions live in docs/metrics.md. Download counts come from OSS access logs
// (or nginx), because the gateway never sees a download.
import { openDatabase, type GatewayDatabase } from './db.js'

const dbPath = process.env.DB_PATH ?? 'data/mareo.db'

function parseDownloads(argv: string[]): number | undefined {
  const index = argv.indexOf('--downloads')
  const raw = index >= 0 ? argv[index + 1] : undefined
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

interface UsageRow {
  total: number
  ok: number
  failed: number
}

function usageSummary(db: GatewayDatabase): UsageRow {
  const row = db
    .prepare('SELECT count(*) total, sum(CASE WHEN status = 200 THEN 1 ELSE 0 END) ok FROM usage')
    .get() as { total: number; ok: number | null }
  const ok = row.ok ?? 0
  return { total: row.total, ok, failed: row.total - ok }
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)}%`
}

function latencySummary(db: GatewayDatabase): { p50: number; p95: number } | undefined {
  const rows = db.prepare('SELECT latencyMs FROM usage WHERE status = 200 ORDER BY latencyMs').all() as {
    latencyMs: number
  }[]
  if (rows.length === 0) return undefined
  const at = (fraction: number) => rows[Math.min(rows.length - 1, Math.floor(rows.length * fraction))].latencyMs
  return { p50: at(0.5), p95: at(0.95) }
}

function eventCounts(db: GatewayDatabase, name: string): { total: number; accounts: number } {
  const row = db
    .prepare('SELECT count(*) total, count(DISTINCT accountId) accounts FROM events WHERE name = ?')
    .get(name) as { total: number; accounts: number }
  return row
}

function detailBreakdown(db: GatewayDatabase, name: string, key: string): { value: string; n: number }[] {
  const rows = db
    .prepare('SELECT json_extract(detail, ?) AS value, count(*) n FROM events WHERE name = ? GROUP BY value ORDER BY n DESC')
    .all(`$.${key}`, name) as { value: string | null; n: number }[]
  return rows.map((row) => ({ value: row.value ?? '(未记录)', n: row.n }))
}

/** The crash tail is stored as JSON in `detail`; keep parsing in one place. */
function parseCrashDetail(detail: string | null): { reason?: string; tail?: string } {
  if (detail === null) return {}
  try {
    return JSON.parse(detail) as { reason?: string; tail?: string }
  } catch {
    return {}
  }
}

function main(): void {
  const db = openDatabase(dbPath)
  const downloads = parseDownloads(process.argv.slice(2))

  console.log(`# Mareo 指标（数据源：${dbPath}）\n`)

  const usage = usageSummary(db)
  const latency = latencySummary(db)
  console.log('## 模型调用稳定性')
  console.log(`  请求 ${usage.total}，成功 ${usage.ok}（${percent(usage.ok, usage.total)}），失败 ${usage.failed}`)
  if (latency) console.log(`  成功请求延迟 p50 ${latency.p50}ms，p95 ${latency.p95}ms`)

  const accounts = db.prepare('SELECT count(*) n FROM users').get() as { n: number }
  const withUsage = db
    .prepare('SELECT count(DISTINCT userId) n FROM usage')
    .get() as { n: number }
  const firstTryOk = db
    .prepare(
      `SELECT count(*) n FROM (
         SELECT userId, min(CASE WHEN status = 200 THEN ts END) firstOk, min(ts) first
         FROM usage GROUP BY userId HAVING firstOk IS NOT NULL
       )`,
    )
    .get() as { n: number }
  console.log('\n## 首次任务成功')
  console.log(`  账户 ${accounts.n}，用过模型 ${withUsage.n}，其中首次调用即成功 ${firstTryOk.n}（${percent(firstTryOk.n, withUsage.n)}）`)

  const launches = db
    .prepare("SELECT platform, json_extract(detail, '$.ok') AS ok, count(*) n FROM events WHERE name = 'launch' GROUP BY platform, ok")
    .all() as { platform: string | null; ok: number | null; n: number }[]
  console.log('\n## 启动稳定性（客户端上报）')
  if (launches.length === 0) {
    console.log('  暂无数据（0.1.3 起才开始上报）')
  } else {
    for (const row of launches) {
      console.log(`  ${row.platform ?? '未知平台'}：${row.ok === 1 ? '成功' : '失败'} ${row.n}`)
    }
  }

  const installs = eventCounts(db, 'install_confirmed')
  console.log('\n## 安装成功率')
  if (installs.total === 0) {
    console.log('  暂无数据（0.1.3 起才开始上报）')
  } else {
    console.log(`  成功安装并启动（去重账户）：${installs.accounts}`)
    if (downloads === undefined) {
      console.log('  下载次数未知：用 --downloads <次数> 传入 OSS 访问日志里的下载完成数即可得到成功率')
    } else {
      console.log(`  下载次数 ${downloads} → 安装成功率 ${percent(installs.accounts, downloads)}`)
    }
  }

  const crashes = db
    .prepare("SELECT accountId, ts, detail FROM events WHERE name = 'harness_exit' ORDER BY id DESC LIMIT 5")
    .all() as { accountId: string | null; ts: string; detail: string | null }[]
  const exits = eventCounts(db, 'harness_exit')
  const launchTotal = launches.reduce((sum, row) => sum + row.n, 0)
  console.log('\n## Harness 异常退出')
  console.log(`  次数 ${exits.total}，涉及账户 ${exits.accounts}，每千次启动 ${launchTotal === 0 ? '—' : ((exits.total / launchTotal) * 1000).toFixed(1)}`)
  for (const row of detailBreakdown(db, 'harness_exit', 'reason')) {
    console.log(`    ${row.value}: ${row.n}`)
  }
  for (const crash of crashes) {
    const detail = parseCrashDetail(crash.detail)
    console.log(`  [${crash.ts.slice(0, 19)}] ${crash.accountId?.slice(0, 8) ?? '匿名'} ${detail.reason ?? ''}`)
    if (detail.tail !== undefined) {
      for (const line of detail.tail.split('\n')) console.log(`      ${line}`)
    }
  }

  const signin = detailBreakdown(db, 'signin', 'result')
  console.log('\n## 登录结果')
  if (signin.length === 0) {
    console.log('  暂无数据（0.1.3 起才开始上报）')
  } else {
    for (const row of signin) console.log(`  ${row.value}: ${row.n}`)
  }
}

main()
