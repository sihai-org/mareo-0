// Renders the public statistics page from the gateway database.
//
//   npm run stats:page                 # prints the page on stdout
//   npm run stats:page -- --downloads 12
//
// It is written to a file by deploy/stats-page.sh and served as a static page, so
// the database is never reachable from the internet and the page cannot leak a
// per-account value: every number here is an aggregate. Definitions live in
// docs/operations.md.
import { openDatabase, type GatewayDatabase } from './db.js'
import { dayStamp, dayStampDaysAgo, startOfDay, startOfDayDaysAgo } from './clock.js'
import { siteViewsSince } from './site-views.js'

const dbPath = process.env.DB_PATH ?? 'data/mareo.db'

/** Escapes every interpolated value: version and platform come from clients. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface Metrics {
  installs: number
  activeToday: number
  activeWeek: number
  launchesWeek: { total: number; ok: number }
  harnessExitsWeek: number
  requestsToday: number
  requestsWeek: number
  okWeek: number
  limitedWeek: number
  latency: { p50: number; p95: number } | undefined
  charsWeek: number
  firstTryOk: number
  accountsWithUsage: number
  accounts: number
  signinWeek: { result: string; n: number }[]
  versions: { version: string; platform: string; n: number }[]
  platforms: { platform: string; n: number }[]
  siteWeek: { total: number; byPath: { path: string; count: number }[] }
}

export function collect(db: GatewayDatabase, now = new Date()): Metrics {
  // Every window is a Beijing calendar day: today for "今日", today plus the
  // previous six days for "近 7 天".
  const day = dayStamp(now)
  const isoDay = startOfDay(now)
  const week = startOfDayDaysAgo(6, now)
  const one = <T>(sql: string, ...params: (string | number)[]): T => db.prepare(sql).get(...params) as T
  const all = <T>(sql: string, ...params: (string | number)[]): T[] => db.prepare(sql).all(...params) as T[]

  const usageWeek = one<{ total: number; ok: number }>(
    `SELECT count(*) total, sum(CASE WHEN status = 200 THEN 1 ELSE 0 END) ok FROM usage WHERE ts >= ?`,
    week,
  )
  const latencyRows = all<{ latencyMs: number }>(
    'SELECT latencyMs FROM usage WHERE status = 200 AND ts >= ? ORDER BY latencyMs',
    week,
  )
  const at = (fraction: number) =>
    latencyRows.length === 0 ? 0 : latencyRows[Math.min(latencyRows.length - 1, Math.floor(latencyRows.length * fraction))].latencyMs

  return {
    installs: one<{ n: number }>(
      "SELECT count(DISTINCT accountId) n FROM events WHERE name = 'install_confirmed' AND accountId IS NOT NULL",
    ).n,
    activeToday: one<{ n: number }>(
      "SELECT count(DISTINCT accountId) n FROM events WHERE name = 'launch' AND accountId IS NOT NULL AND ts >= ?",
      isoDay,
    ).n,
    activeWeek: one<{ n: number }>(
      "SELECT count(DISTINCT accountId) n FROM events WHERE name = 'launch' AND accountId IS NOT NULL AND ts >= ?",
      week,
    ).n,
    launchesWeek: (() => {
      const rows = all<{ ok: number | null; n: number }>(
        `SELECT json_extract(detail, '$.ok') ok, count(*) n FROM events WHERE name = 'launch' AND ts >= ? GROUP BY ok`,
        week,
      )
      const total = rows.reduce((sum, row) => sum + row.n, 0)
      const ok = rows.filter((row) => row.ok === 1).reduce((sum, row) => sum + row.n, 0)
      return { total, ok }
    })(),
    harnessExitsWeek: one<{ n: number }>(
      "SELECT count(*) n FROM events WHERE name = 'harness_exit' AND ts >= ?",
      week,
    ).n,
    requestsToday: one<{ n: number }>('SELECT count(*) n FROM usage WHERE ts >= ?', isoDay).n,
    requestsWeek: usageWeek.total,
    okWeek: usageWeek.ok ?? 0,
    limitedWeek: one<{ n: number }>('SELECT count(*) n FROM usage WHERE status = 429 AND ts >= ?', week).n,
    latency: latencyRows.length === 0 ? undefined : { p50: at(0.5), p95: at(0.95) },
    charsWeek: one<{ n: number | null }>(
      'SELECT sum(promptChars + completionChars) n FROM usage WHERE ts >= ?',
      week,
    ).n ?? 0,
    firstTryOk: one<{ n: number }>(
      `SELECT count(*) n FROM (
         SELECT userId, min(CASE WHEN status = 200 THEN ts END) firstOk FROM usage GROUP BY userId HAVING firstOk IS NOT NULL
       )`,
    ).n,
    accountsWithUsage: one<{ n: number }>('SELECT count(DISTINCT userId) n FROM usage').n,
    accounts: one<{ n: number }>('SELECT count(*) n FROM users').n,
    signinWeek: all<{ result: string; n: number }>(
      `SELECT json_extract(detail, '$.result') result, count(*) n FROM events
       WHERE name = 'signin' AND ts >= ? GROUP BY result ORDER BY n DESC`,
      week,
    ).map((row) => ({ result: row.result ?? '未知', n: row.n })),
    versions: all<{ version: string; platform: string; n: number }>(
      `SELECT version, platform, count(*) n FROM events
       WHERE name = 'launch' AND ts >= ? GROUP BY version, platform ORDER BY n DESC`,
      week,
    ).map((row) => ({ version: row.version ?? '未知', platform: row.platform ?? '未知', n: row.n })),
    platforms: all<{ platform: string; n: number }>(
      `SELECT platform, count(*) n FROM events WHERE name = 'launch' AND ts >= ? GROUP BY platform ORDER BY n DESC`,
      week,
    ).map((row) => ({ platform: row.platform ?? '未知', n: row.n })),
    siteWeek: siteViewsSince(db, dayStampDaysAgo(6, now)),
  }
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`
}

function card(label: string, value: string, note = ''): string {
  return `<div class="card"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${
    note === '' ? '' : `<span class="note">${escapeHtml(note)}</span>`
  }</div>`
}

function rows(items: [string, string][]): string {
  return items
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')
}

export function renderStatsPage(metrics: Metrics, options: { downloads?: number; generatedAt: Date }): string {
  const { siteWeek } = metrics
  const launchRate = metrics.launchesWeek.total === 0 ? '—' : percent(metrics.launchesWeek.ok, metrics.launchesWeek.total)
  const modelRate = metrics.requestsWeek === 0 ? '—' : percent(metrics.okWeek, metrics.requestsWeek)
  const perThousand = metrics.launchesWeek.ok === 0
    ? '—'
    : ((metrics.harnessExitsWeek / metrics.launchesWeek.ok) * 1000).toFixed(1)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Mareo 运营数据</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; font: 15px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #fafbff; color: #14161f; }
.wrap { max-width: 900px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 34px 0 12px; }
.meta { color: #667085; font-size: 13px; margin: 0 0 24px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 14px 16px; display: grid; gap: 2px; }
.card .label { color: #667085; font-size: 13px; }
.card strong { font-size: 24px; font-weight: 650; }
.card .note { color: #98a2b3; font-size: 12px; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid #f0f1f4; font-size: 14px; }
tr:last-child th, tr:last-child td { border-bottom: 0; }
th { font-weight: 450; color: #667085; width: 62%; }
footer { margin-top: 40px; color: #98a2b3; font-size: 13px; }
footer a { color: inherit; }
@media (prefers-color-scheme: dark) {
  body { background: #0f1116; color: #eceff4; }
  .card, table { background: #171a21; border-color: #262a33; }
  th, td { border-color: #23262e; }
  .meta, th, .card .label, footer { color: #98a2b3; }
}
</style>
</head>
<body>
<div class="wrap">
  <h1>Mareo 运营数据</h1>
  <p class="meta">页面生成于 ${escapeHtml(options.generatedAt.toISOString())}（UTC）· 所有数字均为聚合值，不含任何账号信息</p>

  <div class="cards">
    ${card('累计安装', String(metrics.installs), '首次成功启动的设备数')}
    ${card('近 7 天活跃', String(metrics.activeWeek), `今日 ${metrics.activeToday}`)}
    ${card('近 7 天模型请求', String(metrics.requestsWeek), `成功 ${modelRate}`)}
    ${card('官网浏览（近 7 天）', String(siteWeek.total), '仅统计执行 JS 的真实浏览器')}
    ${options.downloads === undefined ? '' : card('安装包下载（近 7 天）', String(options.downloads), '来自官网的下载请求')}
  </div>

  <h2>获客漏斗</h2>
  <table>${rows([
    ['官网浏览（近 7 天）', String(siteWeek.total)],
    ['安装包下载（近 7 天）', options.downloads === undefined ? '未统计' : String(options.downloads)],
    ['累计安装（成功启动并登录）', String(metrics.installs)],
    ['注册账号总数', String(metrics.accounts)],
    ['用上模型的账号', `${metrics.accountsWithUsage}`],
    ['首次调用即成功的账号', `${metrics.firstTryOk} / ${metrics.accountsWithUsage}`],
  ])}</table>

  <h2>稳定性</h2>
  <table>${rows([
    ['启动成功率（近 7 天）', `${launchRate}（${metrics.launchesWeek.ok} / ${metrics.launchesWeek.total}）`],
    ['引擎异常退出（近 7 天）', `${metrics.harnessExitsWeek} 次 · 每千次启动 ${perThousand}`],
    ['模型调用成功率（近 7 天）', `${modelRate}（成功 ${metrics.okWeek}）`],
    ['成功率延迟（近 7 天）', metrics.latency === undefined ? '—' : `p50 ${metrics.latency.p50}ms · p95 ${metrics.latency.p95}ms`],
    ['额度用尽的请求（近 7 天）', `${metrics.limitedWeek} 次`],
    ['登录结果（近 7 天）', metrics.signinWeek.length === 0 ? '暂无数据' : metrics.signinWeek.map((row) => `${row.result} ${row.n}`).join(' · ')],
  ])}</table>

  <h2>用量</h2>
  <table>${rows([
    ['今日模型请求', String(metrics.requestsToday)],
    ['近 7 天模型请求', String(metrics.requestsWeek)],
    ['近 7 天字符量（提示 + 回复）', metrics.charsWeek.toLocaleString('en-US')],
  ])}</table>

  <h2>版本与平台（近 7 天启动）</h2>
  <table>${
    metrics.versions.length === 0
      ? rows([['暂无数据', '—']])
      : metrics.versions.map((row) => `<tr><th>${escapeHtml(row.version)} · ${escapeHtml(row.platform)}</th><td>${row.n}</td></tr>`).join('')
  }</table>

  <footer>
    数据来源：Mareo 网关的聚合统计。<a href="/">返回首页</a> · <a href="/privacy.html">隐私说明</a>
  </footer>
</div>
</body>
</html>
`
}

function main(): void {
  const args = process.argv.slice(2)
  const downloadsIndex = args.indexOf('--downloads')
  const downloads = downloadsIndex >= 0 ? Number.parseInt(args[downloadsIndex + 1] ?? '', 10) : undefined
  const db = openDatabase(dbPath)
  const metrics = collect(db)
  process.stdout.write(
    renderStatsPage(metrics, {
      downloads: Number.isFinite(downloads) ? downloads : undefined,
      generatedAt: new Date(),
    }),
  )
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
