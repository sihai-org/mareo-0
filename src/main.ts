import { app, BrowserWindow, dialog, session, shell } from 'electron'
import path from 'node:path'
import { startDshRuntime, type DshRuntime } from './dsh-runtime.js'

let mainWindow: BrowserWindow | undefined
let dshRuntime: DshRuntime | undefined
let shutdownComplete = false

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

  app.on('window-all-closed', () => app.quit())
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
