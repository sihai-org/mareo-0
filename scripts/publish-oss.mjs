// Uploads release artifacts to Aliyun OSS (the origin behind the CDN).
// Used by the release workflow; skips silently when OSS is not configured.
//
//   OSS_REGION=oss-cn-hangzhou OSS_BUCKET=mareo-downloads \
//   OSS_ACCESS_KEY_ID=... OSS_ACCESS_KEY_SECRET=... \
//   node scripts/publish-oss.mjs --prefix "" file1 file2 ...
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function ossConfiguration(env = process.env) {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = env
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) return undefined
  return {
    region: OSS_REGION,
    bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
  }
}

export function objectKeyFor(file, prefix = '') {
  const cleaned = prefix.replace(/^\/+|\/+$/g, '')
  return cleaned ? `${cleaned}/${path.basename(file)}` : path.basename(file)
}

export async function uploadFiles({ configuration, files, prefix = '' }) {
  const OSS = require('ali-oss')
  const client = new OSS(configuration)
  for (const file of files) {
    const key = objectKeyFor(file, prefix)
    await client.put(key, await readFile(file))
    console.log(`uploaded ${key}`)
  }
}

export function parseArguments(argv) {
  const prefixIndex = argv.indexOf('--prefix')
  const prefix = prefixIndex >= 0 ? (argv[prefixIndex + 1] ?? '') : ''
  const files = argv.filter((argument, index) => {
    if (argument.startsWith('--')) return false
    // Only the value that follows --prefix is not a file.
    return prefixIndex < 0 || index !== prefixIndex + 1
  })
  return { prefix, files }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const configuration = ossConfiguration()
  const { prefix, files } = parseArguments(process.argv.slice(2))
  if (configuration === undefined) {
    console.log('OSS not configured (OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET); skipping upload.')
    process.exit(0)
  }
  if (files.length === 0) {
    console.error('usage: node scripts/publish-oss.mjs [--prefix <dir>] <file...>')
    process.exit(1)
  }
  await uploadFiles({ configuration, files, prefix })
}
