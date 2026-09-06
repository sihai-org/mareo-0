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
const dailyLimit = envNumber('DAILY_LIMIT', 200)

if (apiKey === '') {
  console.error('DEEPSEEK_API_KEY is not set. Copy .env.example to .env and fill in your DeepSeek key.')
  process.exit(1)
}

const db = openDatabase(dbPath)
const server = createGatewayServer({ db, upstreamBaseUrl, apiKey, dailyLimit })

server.listen(port, host, () => {
  console.log(`Mareo gateway listening on http://${host}:${port}`)
  console.log(`Proxying to ${upstreamBaseUrl} with daily limit ${dailyLimit} requests per user`)
})

function shutdown(): void {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
