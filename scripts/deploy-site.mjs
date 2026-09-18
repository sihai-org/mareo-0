// Deploys the static website to the host that serves mareo.cn.
//
//   ECS_HOST=root@114.55.15.112 MAREO_DEPLOY_KEY=~/.ssh/mareo-0.pem npm run deploy:site
//   npm run deploy:site -- --dry-run
//
// The release workflow runs the same command on every tag, so shipping a page
// no longer depends on someone remembering to copy files by hand.
//
// `updates/` (the release manifest) and `downloads/` (legacy 302 target) belong
// to the release pipeline, so they are excluded from the mirror: rsync must
// never delete them.
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Directories on the host that something other than this mirror owns. */
export const EXCLUDED_DIRECTORIES = ['updates/', 'downloads/', 'stats/']

export function rsyncArguments({ source, host, key, targetDirectory }) {
  const withTrailingSlash = (value) => `${value.replace(/\/+$/, '')}/`
  // -i reports only what changed, so "nothing to sync" is distinguishable from
  // "the sync never ran".
  const args = ['-az', '-i', '--delete']
  for (const directory of EXCLUDED_DIRECTORIES) args.push('--exclude', directory)
  // Files are uploaded with a readable mode: nginx cannot serve a 600 file.
  args.push('--chmod=Fu=rw,Fgo=r')
  args.push('-e', `ssh -i ${key} -o StrictHostKeyChecking=accept-new`)
  args.push(withTrailingSlash(source), `${host}:${withTrailingSlash(targetDirectory)}`)
  return args
}

export function parseArguments(argv, env = process.env) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  return {
    source: value('--source') ?? path.join(projectRoot, 'website'),
    host: value('--host') ?? env.ECS_HOST,
    key: value('--key') ?? env.MAREO_DEPLOY_KEY,
    targetDirectory: value('--target') ?? '/var/www/mareo-site',
    url: value('--url') ?? 'https://mareo.cn',
    dryRun: argv.includes('--dry-run'),
  }
}

/**
 * Every page this mirror publishes, derived from what is on disk: adding a page
 * must not be able to ship an unverified URL, and a page that is not in this
 * checkout is not published and so is not required to exist on the host.
 */
export async function localPagePaths() {
  const entries = await readdir(path.join(projectRoot, 'website'))
  return entries
    .filter((name) => name.endsWith('.html'))
    .map((name) => (name === 'index.html' ? '/' : `/${name}`))
    .sort()
}

async function verify(url) {
  const pages = await localPagePaths()
  for (const page of pages) {
    const response = await fetch(`${url}${page}`, { redirect: 'follow' })
    if (!response.ok) throw new Error(`${url}${page} returned ${response.status}`)
    console.log(`verified ${url}${page} (${response.status})`)
  }
  // The assets the page needs must be readable by the web server, not just present.
  const asset = await fetch(`${url}/assets/mareo-workspace.png`, { method: 'HEAD' })
  if (!asset.ok) throw new Error(`${url}/assets/mareo-workspace.png returned ${asset.status}`)
  console.log(`verified hero asset (${asset.status})`)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.host === undefined) {
    throw new Error('需要 ECS_HOST（例如 root@114.55.15.112）')
  }
  if (options.key === undefined) {
    throw new Error('需要 MAREO_DEPLOY_KEY（SSH 私钥文件路径，例如 ~/.ssh/mareo-0.pem）')
  }

  const args = rsyncArguments(options)
  console.log(`rsync ${args.join(' ')}`)
  if (options.dryRun) {
    console.log('[dry-run] 未执行同步。')
    return
  }

  const { stdout } = await execFileAsync('rsync', args, { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 })
  const changes = stdout
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('.d'))
  console.log(changes.length === 0 ? '网站文件已是最新（无需变更）' : `已更新 ${changes.length} 个文件/目录`)
  await verify(options.url)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
