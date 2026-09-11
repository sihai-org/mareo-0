import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  checkToken,
  clearAccount,
  GATEWAY_URL,
  loadAccountSession,
  requestEmailCode,
  saveAccountSession,
  signInWithEmailCode,
  type AccountSession,
} from './account.js'
import { accountHomePath, migrateLegacyHomeOnce } from './account-home.js'
import { startDshRuntime, type DshRuntime } from './dsh-runtime.js'
import { squirrelActionFor, type SquirrelAction } from './squirrel.js'
import { fetchLatestRelease, isNewerVersion, selectDownloadUrl } from './update-check.js'

let mainWindow: BrowserWindow | undefined
let dshRuntime: DshRuntime | undefined
let shutdownComplete = false
// The signed-in account for the current run; used by the account bridge.
let currentAccount: AccountSession | undefined
// While the sign-in window is open there is no main window yet; the app must
// not quit merely because all (gate) windows closed on a successful sign-in.
let signInActive = false

// Main-process failures are written to a log so a Windows user can send the
// stack back when something goes wrong inside the shell.
function logMainProcessError(kind: string, error: unknown): void {
  try {
    const logDirectory = path.join(app.getPath('userData'), 'logs')
    mkdirSync(logDirectory, { recursive: true })
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    appendFileSync(path.join(logDirectory, 'mareo-app.log'), `${new Date().toISOString()} ${kind} ${detail}\n`)
  } catch {
    // Logging must never replace the original failure.
  }
}

process.on('uncaughtException', (error) => {
  logMainProcessError('uncaughtException', error)
  const logFile = path.join(app.getPath('userData'), 'logs', 'mareo-app.log')
  const message = error instanceof Error ? error.message : String(error)
  if (app.isReady()) {
    dialog.showErrorBox('Mareo 遇到错误', `应用即将退出。\n\n${message}\n\n日志：${logFile}`)
  }
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logMainProcessError('unhandledRejection', reason)
})

app.setName('Mareo')
// Keep existing installations' data independent of the display name.
// MAREO_USER_DATA lets a source run use a throwaway data directory, so local
// testing never touches the installed app's sessions or account.
const userDataOverride = process.env.MAREO_USER_DATA
app.setPath(
  'userData',
  userDataOverride && !app.isPackaged ? userDataOverride : path.join(app.getPath('appData'), 'Mareo'),
)

const squirrelAction = squirrelActionFor(process.argv)
if (squirrelAction !== undefined) {
  // Squirrel install/update/uninstall invocation: handle shortcuts and exit
  // without starting the app (otherwise the login window pops up mid-install).
  runSquirrelAction(squirrelAction)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    registerAccountBridge()
    await startMareo()
  }).catch(showFatalError)

  app.on('window-all-closed', () => {
    if (!signInActive) app.quit()
  })
  app.on('before-quit', (event) => {
    if (shutdownComplete || !dshRuntime) return
    event.preventDefault()
    const runtime = dshRuntime
    dshRuntime = undefined
    runtime.stop().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
}

/** Runs the Squirrel lifecycle command by delegating to Update.exe. */
function runSquirrelAction(action: SquirrelAction): void {
  if (action === 'quit') {
    app.quit()
    return
  }
  const updateExe = path.join(path.resolve(path.dirname(process.execPath), '..'), 'Update.exe')
  const executableName = path.basename(process.execPath)
  const args = action === 'create-shortcuts'
    ? ['--createShortcut', executableName]
    : ['--removeShortcut', executableName]
  const child = spawn(updateExe, args, { detached: true, stdio: 'ignore' })
  child.once('error', () => {
    // Nothing to recover here: Squirrel retries on the next install/update.
  })
  child.unref()
  setTimeout(() => app.quit(), 1_000)
}

function legacyDshHome(): string {
  return path.join(app.getPath('userData'), 'dsh')
}

/** Per-account DSH_HOME; the first account migrates the legacy shared home. */
async function resolveDshHome(accountId: string): Promise<string> {
  const dshBase = legacyDshHome()
  const home = accountHomePath(dshBase, accountId)
  await migrateLegacyHomeOnce(dshBase, home)
  return home
}

async function startMareo(): Promise<void> {
  // Windows/Linux show Electron's default File/Edit/View menu bar; macOS keeps
  // its own system menu, so only the other platforms are cleared.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  scheduleUpdateCheck()
  app.dock?.setIcon(path.join(app.getAppPath(), 'assets', 'app-icon.png'))
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

  const account = await acquireAccountSession()
  if (!account) {
    app.quit()
    return
  }
  currentAccount = account

  mainWindow = new BrowserWindow({
    title: 'Mareo',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'assets', 'account-bridge-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow?.setTitle('Mareo')
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  await mainWindow.loadFile(path.join(app.getAppPath(), 'assets', 'startup.html'))

  while (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const runtimeDirectory = app.isPackaged
        ? process.resourcesPath
        : path.join(app.getAppPath(), '.staging')
      const dshHome = account.accountId ? await resolveDshHome(account.accountId) : legacyDshHome()
      dshRuntime = await startDshRuntime({
        runtimeDirectory: path.join(runtimeDirectory, 'dsh-runtime'),
        nodeExecutable: path.join(runtimeDirectory, 'node-runtime', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
        dshHome,
        workingDirectory: app.getPath('home'),
        logFile: path.join(app.getPath('userData'), 'logs', 'mareo.log'),
        env: {
          // Model credentials come from the account, never from the user.
          DEEPSEEK_API_KEY: account.token,
          DEEPSEEK_BASE_URL: GATEWAY_URL,
        },
        onUnexpectedExit: showUnexpectedExit,
      })
      secureDshWindow(mainWindow, dshRuntime.origin)
      await mainWindow.loadURL(dshRuntime.url)
      return
    } catch (error) {
      await dshRuntime?.stop()
      dshRuntime = undefined
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Mareo could not start',
        message: 'DeepSeek Harness failed to start.',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['Retry', 'Quit'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 1) {
        app.quit()
        return
      }
    }
  }
}

/**
 * Returns the account for this launch, showing the sign-in screen when no
 * valid account is stored. Returns undefined when the user quits.
 */
async function acquireAccountSession(): Promise<AccountSession | undefined> {
  const stored = loadAccountSession()
  if (stored && stored.token) {
    const check = await checkToken(stored.token)
    if (check.valid) {
      // Refresh the account id (older stored sessions did not keep one).
      const account = { token: stored.token, accountId: check.accountId }
      if (account.accountId !== stored.accountId) saveAccountSession(account)
      return account
    }
    if (check.reason === 'invalid') {
      // A revoked token is no longer usable; fall through to sign-in.
      clearAccount()
    } else {
      // The gateway is unreachable right now: keep the stored session and let
      // the DSH boot flow surface the connection problem with its retry dialog.
      return stored
    }
  }
  return promptForSignIn()
}

function promptForSignIn(): Promise<AccountSession | undefined> {
  signInActive = true
  const handlers = ['mareo:sign-in', 'mareo:send-code', 'mareo:email-sign-in']
  return new Promise((resolve) => {
    let settled = false
    const settle = (account?: AccountSession): void => {
      if (settled) return
      settled = true
      for (const name of handlers) ipcMain.removeHandler(name)
      if (!signInWindow.isDestroyed()) signInWindow.destroy()
      signInActive = false
      resolve(account)
    }

    const signInWindow = new BrowserWindow({
      title: '登录 Mareo',
      width: 440,
      height: 640,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'assets', 'signin-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    signInWindow.on('closed', () => settle(undefined))
    signInWindow.once('ready-to-show', () => signInWindow.show())

    const gatewayError = `无法连接 Mareo 服务（${GATEWAY_URL}），请稍后重试。`

    ipcMain.handle('mareo:sign-in', async (_event, rawToken: unknown) => {
      if (typeof rawToken !== 'string' || rawToken.trim() === '') {
        return { ok: false, error: '请输入访问令牌。' }
      }
      const token = rawToken.trim()
      const check = await checkToken(token)
      if (!check.valid) {
        return {
          ok: false,
          error: check.reason === 'invalid' ? '该访问令牌无效，请联系管理员。' : gatewayError,
        }
      }
      const account = { token, accountId: check.accountId }
      saveAccountSession(account)
      settle(account)
      return { ok: true }
    })

    ipcMain.handle('mareo:send-code', async (_event, rawEmail: unknown) => {
      if (typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
        return { ok: false, error: '邮箱地址格式不正确。' }
      }
      const result = await requestEmailCode(rawEmail.trim())
      if (result.ok) return { ok: true }
      const messages = {
        cooldown: '发送过于频繁，请 60 秒后再试。',
        'daily-limit': '该邮箱今日发送次数已达上限，请明天再试。',
        'invalid-email': '邮箱地址格式不正确。',
        'delivery-failed': '邮件发送失败，请稍后重试。',
        unreachable: gatewayError,
      }
      return { ok: false, error: messages[result.reason] }
    })

    ipcMain.handle('mareo:email-sign-in', async (_event, rawEmail: unknown, rawCode: unknown) => {
      if (typeof rawEmail !== 'string' || typeof rawCode !== 'string') {
        return { ok: false, error: '请输入邮箱和验证码。' }
      }
      const result = await signInWithEmailCode(rawEmail.trim(), rawCode.trim())
      if (!result.ok) {
        const messages = {
          'no-code': '请先获取验证码。',
          expired: '验证码已过期，请重新获取。',
          'too-many-attempts': '尝试次数过多，请重新获取验证码。',
          'wrong-code': '验证码不正确。',
          'invalid-request': '请求有误，请重试。',
          unreachable: gatewayError,
        }
        return { ok: false, error: messages[result.reason] }
      }
      const account = { token: result.token, accountId: result.accountId }
      saveAccountSession(account)
      settle(account)
      return { ok: true }
    })

    void signInWindow.loadFile(path.join(app.getAppPath(), 'assets', 'signin.html'))
  })
}

const UPDATE_MANIFEST_URL = process.env.MAREO_UPDATE_URL ?? 'https://mareo.cn/updates/latest.json'

/** Checks the release manifest once per launch, without blocking startup. */
function scheduleUpdateCheck(): void {
  if (!app.isPackaged || process.env.MAREO_UPDATE_CHECK === 'off') return
  setTimeout(() => {
    void notifyIfUpdateAvailable()
  }, 10_000)
}

async function notifyIfUpdateAvailable(): Promise<void> {
  const manifest = await fetchLatestRelease(UPDATE_MANIFEST_URL)
  if (manifest === undefined || !isNewerVersion(manifest.version, app.getVersion())) return
  const downloadUrl = selectDownloadUrl(manifest)
  if (downloadUrl === undefined) return

  const options = {
    type: 'info' as const,
    title: 'Mareo 有新版本',
    message: `Mareo ${manifest.version} 已发布（当前 ${app.getVersion()}）`,
    detail: manifest.notes ?? '建议更新以获得最新改进。',
    buttons: ['前往下载', '稍后'],
    defaultId: 0,
    cancelId: 1,
  }
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response === 0) void shell.openExternal(downloadUrl)
}

function registerAccountBridge(): void {
  ipcMain.handle('mareo:account:get', async () => {
    if (!currentAccount) return { ok: false, error: 'signed-out' }
    try {
      const response = await fetch(`${GATEWAY_URL}/me`, {
        headers: { authorization: `Bearer ${currentAccount.token}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (response.status === 200) {
        const body = (await response.json()) as { displayName?: string; email?: string | null }
        return { ok: true, displayName: body.displayName ?? '', email: body.email ?? null }
      }
      return { ok: false, error: 'unauthorized' }
    } catch {
      return { ok: false, error: 'unreachable' }
    }
  })

  ipcMain.handle('mareo:account:update-name', async (_event, rawName: unknown) => {
    const displayName = typeof rawName === 'string' ? rawName.trim() : ''
    if (!currentAccount || displayName.length === 0 || displayName.length > 32) {
      return { ok: false, error: 'invalid-name' }
    }
    try {
      const response = await fetch(`${GATEWAY_URL}/account/name`, {
        method: 'POST',
        headers: { authorization: `Bearer ${currentAccount.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
        signal: AbortSignal.timeout(8_000),
      })
      if (response.status === 200) return { ok: true, displayName }
      return { ok: false, error: 'failed' }
    } catch {
      return { ok: false, error: 'unreachable' }
    }
  })

  ipcMain.handle('mareo:account:sign-out', async () => {
    if (currentAccount) {
      try {
        await fetch(`${GATEWAY_URL}/account/sign-out`, {
          method: 'POST',
          headers: { authorization: `Bearer ${currentAccount.token}` },
          signal: AbortSignal.timeout(8_000),
        })
      } catch {
        // Even if the network call fails, sign out locally.
      }
    }
    setTimeout(() => {
      void returnToSignIn()
    }, 0)
    return { ok: true }
  })
}

/** Tears down the running session and shows the sign-in window again. */
async function returnToSignIn(): Promise<void> {
  signInActive = true
  if (dshRuntime) {
    const runtime = dshRuntime
    dshRuntime = undefined
    await runtime.stop()
  }
  currentAccount = undefined
  clearAccount()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
  mainWindow = undefined
  await startMareo()
}

function secureDshWindow(window: BrowserWindow, allowedOrigin: string): void {
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (new URL(navigationUrl).origin !== allowedOrigin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void shell.openExternal(target.toString())
      }
    } catch {
      // Invalid and unsupported links stay closed.
    }
    return { action: 'deny' }
  })
}

function showUnexpectedExit(message: string): void {
  dshRuntime = undefined
  if (!mainWindow || mainWindow.isDestroyed()) return
  void dialog
    .showMessageBox(mainWindow, {
      type: 'error',
      title: 'Mareo stopped',
      message,
      detail: `The current log is stored at ${path.join(app.getPath('userData'), 'logs', 'mareo.log')}.`,
      buttons: ['Quit'],
    })
    .then(() => app.quit())
}

function showFatalError(error: unknown): void {
  dialog.showErrorBox('Mareo could not start', error instanceof Error ? error.message : String(error))
  app.quit()
}
