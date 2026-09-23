import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

interface OssModule {
  parseArguments(argv: string[]): { prefix: string; files: string[] }
  objectKeyFor(file: string, prefix?: string): string
  ossConfiguration(env: NodeJS.ProcessEnv): Record<string, string> | undefined
  uploadFiles(options: { configuration: Record<string, string>; files: string[]; prefix?: string }): Promise<void>
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

test('uploads an artifact in parts, so one request cannot time out', async () => {
  const { uploadFiles } = await ossModule()
  const entry = require.resolve('ali-oss')
  const calls: { key: string; file: string; options: Record<string, unknown>; clientOptions: Record<string, unknown> }[] = []
  const original = require.cache[entry]
  require.cache[entry] = {
    id: entry,
    filename: entry,
    loaded: true,
    exports: class FakeOss {
      constructor(readonly options: Record<string, unknown>) {}
      async multipartUpload(key: string, file: string, options: Record<string, unknown>): Promise<void> {
        calls.push({ key, file, options, clientOptions: this.options })
      }
      async put(): Promise<void> {
        throw new Error('put() sends the whole installer in one request, which is what timed out')
      }
    },
  } as unknown as NodeModule
  try {
    await uploadFiles({
      configuration: { region: 'oss-cn-hangzhou', bucket: 'mareo-downloads', accessKeyId: 'id', accessKeySecret: 'secret' },
      files: ['/tmp/Mareo-0.1.8-macos-arm64.dmg'],
      prefix: 'downloads',
    })
  } finally {
    if (original === undefined) delete require.cache[entry]
    else require.cache[entry] = original
  }

  assert.equal(calls.length, 1)
  assert.equal(calls[0].key, 'downloads/Mareo-0.1.8-macos-arm64.dmg')
  // The path is handed over, not a Buffer: multipartUpload streams the parts.
  assert.equal(calls[0].file, '/tmp/Mareo-0.1.8-macos-arm64.dmg')
  assert.equal(calls[0].options.partSize, 8 * 1024 * 1024)
  assert.ok(Number(calls[0].clientOptions.timeout) > 60_000, 'default 60 s response timeout would fail again')
  assert.ok(Number(calls[0].clientOptions.retryMax) > 0, 'a dropped part must be retried')
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
