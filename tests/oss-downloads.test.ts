import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

interface OssDownloadsModule {
  splitLogFields: (line: string) => string[]
  parseDownloadLine: (line: string) => { artifact: string; status: number } | undefined
  isInstaller: (artifact: string) => boolean
  summarizeDownloads: (lines: string[]) => {
    succeeded: Map<string, number>
    failed: Map<string, number>
    installerTotal: number
  }
  parseArguments: (argv: string[]) => { prefix: string; days: number }
}

async function module_(): Promise<OssDownloadsModule> {
  const script = pathToFileURL(path.resolve('scripts/oss-downloads.mjs')).href
  return (await import(script)) as OssDownloadsModule
}

/** One OSS access-log line, in the documented S3-shaped field order. */
function logLine({
  operation = 'GetObject',
  key,
  status = '200',
  uri,
}: {
  operation?: string
  key: string
  status?: string
  uri?: string
}): string {
  return [
    '"1657786863000000"',
    '"mareo-downloads"',
    '"13/Sep/2026:15:39:34 +0800"',
    '"203.0.113.7"',
    '"1657786863"',
    '"req-abc"',
    `"${operation}"`,
    `"${key}"`,
    `"GET /${uri ?? key} HTTP/1.1"`,
    `"${status}"`,
    '"-"',
    '"216157513"',
    '"216157513"',
    '"120"',
    '"30"',
    '"-"',
    '"curl/8.7.1"',
    '"hangzhou"',
    '"true"',
    '"-"',
  ].join(' ')
}

test('splits quoted fields and drops the quotes', async () => {
  const { splitLogFields } = await module_()
  const fields = splitLogFields(
    '"bucket" "13/Sep/2026:15:39:34 +0800" "GetObject" "Mareo-0.1.3-macos-arm64.dmg" "GET /x HTTP/1.1" "200"',
  )
  assert.deepEqual(fields, [
    'bucket',
    '13/Sep/2026:15:39:34 +0800',
    'GetObject',
    'Mareo-0.1.3-macos-arm64.dmg',
    'GET /x HTTP/1.1',
    '200',
  ])
})

test('counts only successful artifact downloads', async () => {
  const { summarizeDownloads } = await module_()
  const { succeeded, failed, installerTotal } = summarizeDownloads([
    logLine({ key: 'Mareo-0.1.3-macos-arm64.dmg' }),
    logLine({ key: 'Mareo-0.1.3-macos-arm64.dmg' }),
    logLine({ key: 'Mareo-0.1.3-windows-x64-setup.exe' }),
    logLine({ key: 'MareoSetup.exe' }),
    logLine({ key: 'app-icon.ico' }),
    logLine({ key: 'latest.json' }),
    // A miss, a listing, a HEAD and a log object of our own must not count.
    logLine({ key: 'Mareo-0.0.9-macos-arm64.dmg', status: '404' }),
    logLine({ operation: 'ListObjects', key: 'mareo-downloads' }),
    logLine({ operation: 'HeadObject', key: 'MareoSetup.exe' }),
    logLine({ operation: 'PutObject', key: 'oss-accesslog/mareo-downloads/20260913/x.log' }),
  ])

  assert.equal(succeeded.get('Mareo-0.1.3-macos-arm64.dmg'), 2)
  assert.equal(succeeded.get('Mareo-0.1.3-windows-x64-setup.exe'), 1)
  assert.equal(succeeded.get('MareoSetup.exe'), 1)
  assert.equal(succeeded.get('app-icon.ico'), 1)
  assert.equal(failed.get('Mareo-0.0.9-macos-arm64.dmg'), 1)
  // 2 dmg + 1 versioned exe + 1 MareoSetup.exe; the icon and manifest stay out.
  assert.equal(installerTotal, 4)
})

test('ignores lines it does not understand', async () => {
  const { parseDownloadLine, summarizeDownloads } = await module_()
  assert.equal(parseDownloadLine(''), undefined)
  assert.equal(parseDownloadLine('garbage without fields'), undefined)
  assert.equal(parseDownloadLine(logLine({ key: 'some/other/object.txt' })), undefined)

  const { succeeded, failed } = summarizeDownloads(['garbage', '', logLine({ key: 'RELEASES' })])
  assert.equal(succeeded.get('RELEASES'), 1)
  assert.equal(failed.size, 0)
})

test('defaults to the log prefix for seven days', async () => {
  const { parseArguments } = await module_()
  assert.deepEqual(parseArguments([]), { prefix: 'oss-accesslog/', days: 7 })
  assert.deepEqual(parseArguments(['--days', '30', '--prefix', 'logs/']), { prefix: 'logs/', days: 30 })
  assert.deepEqual(parseArguments(['--days', 'nonsense']), { prefix: 'oss-accesslog/', days: 7 })
})
