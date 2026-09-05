import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { get } from 'node:https'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestDirectory = path.join(projectDirectory, 'runtime')
const stagingRoot = path.join(projectDirectory, '.staging')
const dshStagingDirectory = path.join(stagingRoot, 'dsh-runtime')
const nodeStagingDirectory = path.join(stagingRoot, 'node-runtime')
const manifest = JSON.parse(await readFile(path.join(manifestDirectory, 'package.json'), 'utf8'))
const nodeRuntime = manifest.mareo?.node

if (!nodeRuntime || nodeRuntime.platform !== process.platform || nodeRuntime.arch !== process.arch) {
  throw new Error(`The V0 runtime supports ${nodeRuntime?.platform}/${nodeRuntime?.arch}, not ${process.platform}/${process.arch}.`)
}

await rm(stagingRoot, { recursive: true, force: true })
await mkdir(dshStagingDirectory, { recursive: true })
await Promise.all([
  cp(path.join(manifestDirectory, 'package.json'), path.join(dshStagingDirectory, 'package.json')),
  cp(path.join(manifestDirectory, 'package-lock.json'), path.join(dshStagingDirectory, 'package-lock.json')),
])

await run('npm', ['ci', '--omit=dev'], dshStagingDirectory)
await stageNodeRuntime(nodeRuntime)
await run(process.execPath, [path.join(projectDirectory, 'scripts', 'verify-runtime.mjs'), stagingRoot], projectDirectory)

async function stageNodeRuntime(nodeConfig) {
  const archiveName = `node-v${nodeConfig.version}-${nodeConfig.platform}-${nodeConfig.arch}.tar.gz`
  const cacheDirectory = path.join(projectDirectory, '.cache', 'node')
  const archivePath = path.join(cacheDirectory, archiveName)
  const extractionDirectory = path.join(stagingRoot, 'node-extraction')
  const distributionDirectory = path.join(extractionDirectory, archiveName.replace(/\.tar\.gz$/, ''))

  await mkdir(cacheDirectory, { recursive: true })
  try {
    await verifyChecksum(archivePath, nodeConfig.sha256)
  } catch {
    await download(`https://nodejs.org/dist/v${nodeConfig.version}/${archiveName}`, archivePath)
    await verifyChecksum(archivePath, nodeConfig.sha256)
  }

  await mkdir(extractionDirectory, { recursive: true })
  await run('tar', ['-xzf', archivePath, '-C', extractionDirectory], projectDirectory)
  await mkdir(path.join(nodeStagingDirectory, 'bin'), { recursive: true })
  await Promise.all([
    cp(path.join(distributionDirectory, 'bin', 'node'), path.join(nodeStagingDirectory, 'bin', 'node')),
    cp(path.join(distributionDirectory, 'LICENSE'), path.join(nodeStagingDirectory, 'LICENSE')),
  ])
  await rm(extractionDirectory, { recursive: true, force: true })
}

async function verifyChecksum(filename, expected) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filename), hash)
  if (hash.digest('hex') !== expected) throw new Error(`Checksum verification failed for ${filename}.`)
}

async function download(url, destination) {
  const partial = `${destination}.partial`
  await rm(partial, { force: true })
  await downloadToFile(url, partial)
  await rename(partial, destination)
}

async function downloadToFile(url, destination) {
  await new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        downloadToFile(new URL(response.headers.location, url).toString(), destination).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`))
        return
      }
      pipeline(response, createWriteStream(partial)).then(resolve, reject)
    })
    request.once('error', reject)
  })
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}
