import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

interface DeploySiteModule {
  EXCLUDED_DIRECTORIES: string[]
  rsyncArguments: (options: {
    source: string
    host: string
    key: string
    targetDirectory: string
  }) => string[]
  localPagePaths: () => Promise<string[]>
  parseArguments: (argv: string[], env: Record<string, string | undefined>) => {
    source: string
    host: string | undefined
    key: string | undefined
    targetDirectory: string
    url: string
    dryRun: boolean
  }
}

async function module_(): Promise<DeploySiteModule> {
  const script = pathToFileURL(path.resolve('scripts/deploy-site.mjs')).href
  return (await import(script)) as DeploySiteModule
}

test('the mirror never touches the directories the release pipeline owns', async () => {
  const { rsyncArguments, EXCLUDED_DIRECTORIES } = await module_()
  const args = rsyncArguments({
    source: '/repo/website',
    host: 'root@114.55.15.112',
    key: '/tmp/key',
    targetDirectory: '/var/www/mareo-site',
  })

  // stats/ holds the generated operations page, which a plain mirror would delete.
  assert.deepEqual(EXCLUDED_DIRECTORIES, ['updates/', 'downloads/', 'stats/'])
  for (const directory of EXCLUDED_DIRECTORIES) {
    assert.equal(args[args.indexOf('--exclude') + 1] !== undefined, true)
    assert.ok(args.includes(directory), `${directory} must be excluded`)
  }
  assert.ok(args.includes('--delete'))
  // nginx serves files as www-data; a 600 upload would 403.
  assert.ok(args.includes('--chmod=Fu=rw,Fgo=r'))
  assert.ok(args.includes('/repo/website/'))
  assert.ok(args.includes('root@114.55.15.112:/var/www/mareo-site/'))
  assert.equal(args[args.indexOf('-e') + 1], 'ssh -i /tmp/key -o StrictHostKeyChecking=accept-new')
})

test('trailing slashes are normalised so rsync mirrors contents, not the directory', async () => {
  const { rsyncArguments } = await module_()
  const args = rsyncArguments({
    source: '/repo/website///',
    host: 'root@host',
    key: '/k',
    targetDirectory: '/var/www/site/',
  })
  assert.ok(args.includes('/repo/website/'))
  assert.ok(args.includes('root@host:/var/www/site/'))
})

test('every page in the checkout is verified after publishing', async () => {
  const { localPagePaths } = await module_()
  const pages = await localPagePaths()

  // index.html is the site root; every other page keeps its own name.
  assert.ok(pages.includes('/'), 'the root page must be verified')
  assert.ok(!pages.includes('/index.html'), 'index.html is served as /')
  for (const page of pages) {
    assert.match(page, /^\/[a-z0-9-]*\.html$|^\/$/)
  }
  // The pages on disk are exactly the pages checked, so adding one cannot ship
  // a URL nobody verified (privacy-en.html was added that way).
  assert.deepEqual([...pages].sort(), pages, 'the list is sorted for a stable log')
  const onDisk = readdirSync(path.resolve('website')).filter((name) => name.endsWith('.html'))
  assert.equal(pages.length, onDisk.length)
  for (const name of onDisk) {
    assert.ok(pages.includes(name === 'index.html' ? '/' : `/${name}`), `${name} must be verified`)
  }
})

test('host and key come from the environment with flags as overrides', async () => {
  const { parseArguments } = await module_()
  const fromEnv = parseArguments([], { ECS_HOST: 'root@1.2.3.4', MAREO_DEPLOY_KEY: '/tmp/k' })
  assert.equal(fromEnv.host, 'root@1.2.3.4')
  assert.equal(fromEnv.key, '/tmp/k')
  assert.equal(fromEnv.targetDirectory, '/var/www/mareo-site')
  assert.equal(fromEnv.dryRun, false)
  assert.match(fromEnv.source, /website$/)

  const fromFlags = parseArguments(
    ['--host', 'root@5.6.7.8', '--key', '/tmp/other', '--source', '/tmp/site', '--target', '/srv/www', '--dry-run'],
    {},
  )
  assert.equal(fromFlags.host, 'root@5.6.7.8')
  assert.equal(fromFlags.key, '/tmp/other')
  assert.equal(fromFlags.source, '/tmp/site')
  assert.equal(fromFlags.targetDirectory, '/srv/www')
  assert.equal(fromFlags.dryRun, true)
})
