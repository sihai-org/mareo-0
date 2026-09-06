import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const STARTUP_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 5_000

export interface DshRuntime {
  url: string
  origin: string
  stop(): Promise<void>
}

interface StartDshRuntimeOptions {
  runtimeDirectory: string
  nodeExecutable: string
  dshHome: string
  workingDirectory: string
  logFile: string
  /** Extra environment variables merged over the process environment. */
  env?: Record<string, string>
  onUnexpectedExit(message: string): void
}

interface DshPackageJson {
  bin?: {
    dsh?: string
  }
}

export function extractDshUrl(output: string): string | undefined {
  const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)
  if (!match) return undefined

  try {
    return new URL(match[0]).toString()
  } catch {
    return undefined
  }
}

export async function startDshRuntime(options: StartDshRuntimeOptions): Promise<DshRuntime> {
  const dshPackageDirectory = path.join(options.runtimeDirectory, 'node_modules', '@deepseek-ai', 'dsh')
  const packageJson = JSON.parse(
    await readFile(path.join(dshPackageDirectory, 'package.json'), 'utf8'),
  ) as DshPackageJson

  if (!packageJson.bin?.dsh) {
    throw new Error('The packaged DSH runtime does not declare a dsh CLI entry.')
  }

  // DSH resolves third-party plugins from its profile, so use the installed
  // package's file URL. This app-owned overlay never rewrites user config.
  await mkdir(options.dshHome, { recursive: true })
  const brandPatch = path.join(options.dshHome, 'mareo-brand.patch.json')
  await writeFile(brandPatch, JSON.stringify([
    { id: 'ui-brand-official', disabled: true },
    { insert: [{ id: 'mareo-brand', name: pathToFileURL(path.join(options.runtimeDirectory, 'node_modules', 'mareo-brand', 'index.js')).href }] },
  ]))
  await mkdir(path.dirname(options.logFile), { recursive: true })
  const log = createWriteStream(options.logFile, { flags: 'w' })
  const child = spawn(
    options.nodeExecutable,
    [
      '--expose-internals',
      path.join(dshPackageDirectory, packageJson.bin.dsh),
      'web',
      '--patch',
      brandPatch,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ],
    {
      cwd: options.workingDirectory,
      detached: true,
      env: {
        ...process.env,
        DSH_HOME: options.dshHome,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stopping = false
  let ready = false
  let output = ''
  let recentErrorOutput = ''
  let exitDescription: string | undefined
  let resolveExit: (() => void) | undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output = (output + text).slice(-16_384)
    log.write(redactDshToken(text))
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    recentErrorOutput = (recentErrorOutput + text).slice(-4_096)
    log.write(text)
  })
  child.once('error', (error) => {
    recentErrorOutput = (recentErrorOutput + error.message).slice(-4_096)
  })
  child.on('close', (code, signal) => {
    exitDescription = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`
    log.end()
    resolveExit?.()
    if (ready && !stopping) {
      options.onUnexpectedExit(`DeepSeek Harness exited unexpectedly (${exitDescription}).`)
    }
  })

  try {
    const url = await waitForDshUrl(() => output, () => exitDescription)
    await waitUntilReachable(url, () => exitDescription)
    ready = true

    return {
      url,
      origin: new URL(url).origin,
      async stop() {
        if (stopping || exitDescription !== undefined) return
        stopping = true
        signalProcessGroup(child.pid, 'SIGTERM')
        await Promise.race([
          exited,
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ])
        if (exitDescription === undefined) {
          signalProcessGroup(child.pid, 'SIGKILL')
          await exited
        }
      },
    }
  } catch (error) {
    stopping = true
    if (exitDescription === undefined) signalProcessGroup(child.pid, 'SIGTERM')
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ])
    const detail = recentErrorOutput.trim()
    throw new Error(detail ? `${messageFrom(error)}\n\n${detail}` : messageFrom(error))
  }
}

async function waitForDshUrl(
  currentOutput: () => string,
  currentExit: () => string | undefined,
): Promise<string> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    const url = extractDshUrl(currentOutput())
    if (url) return url
    const exitDescription = currentExit()
    if (exitDescription !== undefined) {
      throw new Error(`DeepSeek Harness exited before startup completed (${exitDescription}).`)
    }
    await delay(100)
  }

  throw new Error('Timed out waiting for DeepSeek Harness to report its local address.')
}

async function waitUntilReachable(url: string, currentExit: () => string | undefined): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    const exitDescription = currentExit()
    if (exitDescription !== undefined) {
      throw new Error(`DeepSeek Harness exited during its health check (${exitDescription}).`)
    }

    if (await probeLocalUrl(url)) return
    await delay(150)
  }

  throw new Error('Timed out waiting for the DeepSeek Harness Web UI.')
}

function probeLocalUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume()
      resolve(response.statusCode !== undefined && response.statusCode < 400)
    })
    request.setTimeout(1_000, () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function redactDshToken(output: string): string {
  return output.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
