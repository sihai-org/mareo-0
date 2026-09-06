import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import {
  checkToken,
  clearAccount,
  GATEWAY_URL,
  loadAccountToken,
  saveAccountToken,
} from './account.js'
import { startDshRuntime, type DshRuntime } from './dsh-runtime.js'

let mainWindow: BrowserWindow | undefined
let dshRuntime: DshRuntime | undefined
let shutdownComplete = false
// While the sign-in window is open there is no main window yet; the app must
// not quit merely because all (gate) windows closed on a successful sign-in.
let signInActive = false

app.setName('Mareo')
// Keep existing installations' data independent of the display name.
app.setPath('userData', path.join(app.getPath('appData'), 'Mareo'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(startMareo).catch(showFatalError)

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

async function startMareo(): Promise<void> {
  app.dock?.setIcon(path.join(app.getAppPath(), 'assets', 'app-icon.png'))
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

  const accountToken = await acquireAccountToken()
  if (!accountToken) {
    app.quit()
    return
  }

  mainWindow = new BrowserWindow({
    title: 'Mareo',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: {
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
      dshRuntime = await startDshRuntime({
        runtimeDirectory: path.join(runtimeDirectory, 'dsh-runtime'),
        nodeExecutable: path.join(runtimeDirectory, 'node-runtime', 'bin', 'node'),
        dshHome: path.join(app.getPath('userData'), 'dsh'),
        workingDirectory: app.getPath('home'),
        logFile: path.join(app.getPath('userData'), 'logs', 'mareo.log'),
        env: {
          // Model credentials come from the account, never from the user.
          DEEPSEEK_API_KEY: accountToken,
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
 * Returns the gateway token to use for this launch, showing the sign-in screen
 * when no valid account is stored. Returns undefined when the user quits.
 */
async function acquireAccountToken(): Promise<string | undefined> {
  const stored = loadAccountToken()
  if (stored) {
    const check = await checkToken(stored)
    if (check.valid) return stored
    if (check.reason === 'invalid') {
      // A revoked token is no longer usable; fall through to sign-in.
      clearAccount()
    } else {
      // The gateway is unreachable right now: keep the stored token and let the
      // DSH boot flow surface the connection problem with its own retry dialog.
      return stored
    }
  }
  return promptForToken()
}

function promptForToken(): Promise<string | undefined> {
  signInActive = true
  return new Promise((resolve) => {
    let settled = false
    const settle = (token?: string): void => {
      if (settled) return
      settled = true
      ipcMain.removeHandler('mareo:sign-in')
      if (!signInWindow.isDestroyed()) signInWindow.destroy()
      signInActive = false
      resolve(token)
    }

    const signInWindow = new BrowserWindow({
      title: 'Sign in to Mareo',
      width: 420,
      height: 560,
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

    ipcMain.handle('mareo:sign-in', async (_event, rawToken: unknown) => {
      if (typeof rawToken !== 'string' || rawToken.trim() === '') {
        return { ok: false, error: 'Enter your access token first.' }
      }
      const token = rawToken.trim()
      const check = await checkToken(token)
      if (!check.valid) {
        const error =
          check.reason === 'invalid'
            ? 'This token is not valid. Check the token with your provider.'
            : `Cannot reach the Mareo gateway at ${GATEWAY_URL}. Is it running?`
        return { ok: false, error }
      }
      saveAccountToken(token)
      settle(token)
      return { ok: true }
    })

    void signInWindow.loadFile(path.join(app.getAppPath(), 'assets', 'signin.html'))
  })
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
  void dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Mareo stopped',
    message,
    detail: `The current log is stored at ${path.join(app.getPath('userData'), 'logs', 'mareo.log')}.`,
    buttons: ['Quit'],
  }).then(() => app.quit())
}

function showFatalError(error: unknown): void {
  dialog.showErrorBox('Mareo could not start', error instanceof Error ? error.message : String(error))
  app.quit()
}
