import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

interface OssModule {
  parseArguments(argv: string[]): { prefix: string; files: string[] }
  objectKeyFor(file: string, prefix?: string): string
  ossConfiguration(env: NodeJS.ProcessEnv): Record<string, string> | undefined
}

async function ossModule(): Promise<OssModule> {
  const script = pathToFileURL(path.resolve('scripts/publish-oss.mjs')).href
  return (await import(script)) as OssModule
}

test('treats every bare argument as a file', async () => {
  const { parseArguments } = await ossModule()
  assert.deepEqual(parseArguments(['a.dmg', 'b.exe']), { prefix: '', files: ['a.dmg', 'b.exe'] })
  assert.deepEqual(parseArguments(['--prefix', 'releases', 'a.dmg']), { prefix: 'releases', files: ['a.dmg'] })
  assert.deepEqual(parseArguments(['a.dmg', '--prefix', 'releases']), { prefix: 'releases', files: ['a.dmg'] })
})

test('builds object keys with and without a prefix', async () => {
  const { objectKeyFor } = await ossModule()
  assert.equal(objectKeyFor('/tmp/x/MareoSetup.exe'), 'MareoSetup.exe')
  assert.equal(objectKeyFor('/tmp/x/MareoSetup.exe', 'releases/'), 'releases/MareoSetup.exe')
})

test('requires a complete OSS configuration', async () => {
  const { ossConfiguration } = await ossModule()
  assert.equal(ossConfiguration({} as NodeJS.ProcessEnv), undefined)
  assert.deepEqual(
    ossConfiguration({
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'mareo-downloads',
      OSS_ACCESS_KEY_ID: 'id',
      OSS_ACCESS_KEY_SECRET: 'secret',
    } as NodeJS.ProcessEnv),
    { region: 'oss-cn-hangzhou', bucket: 'mareo-downloads', accessKeyId: 'id', accessKeySecret: 'secret' },
  )
})
