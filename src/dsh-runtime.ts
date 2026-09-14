import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { stripLocalPaths } from './telemetry.js'

const execFileAsync = promisify(execFile)

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
  /**
   * Called when DSH dies on its own. The second argument is the tail of its
   * stderr, already stripped of paths and tokens, for the crash report.
   */
  onUnexpectedExit(message: string, errorOutput: string): void
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
      // POSIX uses a process group so the whole DSH tree can be signalled at
      // once; Windows has no process groups, so it is killed via taskkill.
      detached: process.platform !== 'win32',
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
      options.onUnexpectedExit(
        `DeepSeek Harness exited unexpectedly (${exitDescription}).`,
        reportableErrorOutput(recentErrorOutput),
      )
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
        await terminateDshTree(child.pid, 'SIGTERM')
        await Promise.race([
          exited,
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ])
        if (exitDescription === undefined) {
          await terminateDshTree(child.pid, 'SIGKILL')
          await exited
        }
      },
    }
  } catch (error) {
    stopping = true
    if (exitDescription === undefined) await terminateDshTree(child.pid, 'SIGTERM')
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

/**
 * What we are willing to send about a crash: the last few lines of technical
 * output, with local paths and the DSH launch token removed and a hard size cap.
 * Anything longer is a conversation fragment, not a stack trace.
 */
export function reportableErrorOutput(text: string, maxLines = 20, maxChars = 4_000): string {
  const cleaned = stripLocalPaths(redactDshToken(text))
  const lines = cleaned
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
  const tail = lines.slice(-maxLines).join('\n')
  return tail.length > maxChars ? tail.slice(-maxChars) : tail
}

function redactDshToken(output: string): string {
  return output.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')
}

/** Stops the DSH process and its children on the current platform. */
async function terminateDshTree(pid: number | undefined, signal: NodeJS.Signals): Promise<void> {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    // taskkill /T terminates the whole tree; /F is required for the force case
    // since Windows has no SIGKILL.
    const args = ['/pid', String(pid), '/T']
    if (signal === 'SIGKILL') args.push('/F')
    try {
      await execFileAsync('taskkill', args)
    } catch {
      // The process may already be gone.
    }
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
