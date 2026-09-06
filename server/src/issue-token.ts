import { createUser, openDatabase, storeToken, type GatewayDatabase } from './db.js'
import { generateTokenSecret, hashToken } from './auth.js'

interface CliArguments {
  label: string
  dbPath: string
}

function parseArguments(argv: string[]): CliArguments {
  const label = argv.find((argument) => !argument.startsWith('-'))
  const dbFlagIndex = argv.indexOf('--db')
  const dbPath = dbFlagIndex >= 0 && argv[dbFlagIndex + 1] ? argv[dbFlagIndex + 1] : process.env.DB_PATH ?? 'data/mareo.db'
  if (label === undefined) {
    console.error('usage: issue-token <label> [--db <path>]')
    console.error('label: display name of the user this token belongs to (a new user row is created)')
    process.exit(1)
  }
  return { label, dbPath }
}

const { label, dbPath } = parseArguments(process.argv.slice(2))
const db: GatewayDatabase = openDatabase(dbPath)
const userId = createUser(db, { displayName: label, provider: 'token' })
const secret = generateTokenSecret()
storeToken(db, { userId, label, tokenHash: hashToken(secret) })
db.close()

console.log(secret)
console.error(
  `Token issued for user "${label}" (id ${userId}). Paste the token printed above into the Mareo sign-in screen.`,
)
