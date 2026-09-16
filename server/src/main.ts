import { openDatabase } from './db.js'
import { createGatewayServer } from './server.js'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

const port = envNumber('PORT', 3000)
const host = process.env.HOST ?? '127.0.0.1'
const dbPath = process.env.DB_PATH ?? 'data/mareo.db'
const upstreamBaseUrl = process.env.UPSTREAM_BASE_URL ?? 'https://api.deepseek.com'
const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
// The cap is a runaway guard, not a product quota: it should be far above any
// real day of use, and DAILY_WARN_LIMIT is what actually tells us to look.
const dailyLimit = envNumber('DAILY_LIMIT', 2000)
const dailyWarnLimit = envNumber('DAILY_WARN_LIMIT', 500)

if (apiKey === '') {
  console.error('DEEPSEEK_API_KEY is not set. Copy .env.example to .env and fill in your DeepSeek key.')
  process.exit(1)
}

const db = openDatabase(dbPath)
const server = createGatewayServer({ db, upstreamBaseUrl, apiKey, dailyLimit, dailyWarnLimit,
  sponsoredAdFile: process.env.SPONSORED_AD_FILE ?? 'data/sponsored-ad.json' })

server.listen(port, host, () => {
  console.log(`Mareo gateway listening on http://${host}:${port}`)
  console.log(`Proxying to ${upstreamBaseUrl} with daily limit ${dailyLimit} requests per user (warn at ${dailyWarnLimit})`)
})

function shutdown(): void {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
