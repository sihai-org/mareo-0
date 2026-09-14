import assert from 'node:assert/strict'
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

  assert.deepEqual(EXCLUDED_DIRECTORIES, ['updates/', 'downloads/'])
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
