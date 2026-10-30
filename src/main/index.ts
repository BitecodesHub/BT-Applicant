import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, session, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { mkdirSync } from 'node:fs'
import { version as appVersion } from '../../package.json'
import { AppContainer } from './services/container'
import { registerIpc, exportData, openWebApplicationWindow } from './ipc'
import { getApplication } from './db/repos/applications'
import { createLogger, getLogger } from './core/logger'
import type { SecretCipher } from './core/secrets'
import type { DigestSummary } from '../shared/types'

const isDev = !app.isPackaged
// Isolated profile for automated end-to-end runs; never set in normal launches.
if (process.env.BT_APPLICANT_USER_DATA) app.setPath('userData', process.env.BT_APPLICANT_USER_DATA)
const appDataDir = (): string => app.getPath('userData')

let container: AppContainer | null = null
let mainWindow: BrowserWindow | null = null
let stopStarted = false

const cipher: SecretCipher = {
  encrypt: (plainText: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system keychain is unavailable, so secrets cannot be stored safely.')
    }
    return safeStorage.encryptString(plainText).toString('base64')
  },
  decrypt: (cipherText: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system keychain is unavailable, so stored secrets cannot be read.')
    }
    return safeStorage.decryptString(Buffer.from(cipherText, 'base64'))
  }
}

function notifyChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:data-changed')
  }
}

function notifyDigest(summary: DigestSummary): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'BT Applicant — daily report',
    body: summary.headline
  })
  notification.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('app:navigate', '/daily')
  })
  notification.show()
}

function applyCsp(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isAppUrl = details.url.startsWith('file://') || (devUrl ? details.url.startsWith(devUrl) : false)
    if (!isAppUrl) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const policy = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http: https:; object-src 'none'; frame-src 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    title: 'BT Applicant',
    backgroundColor: '#0b0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerSystemHandlers(): void {
  ipcMain.handle('system:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  })

  ipcMain.handle('system:open-path', async (_event, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path')
    const root = resolve(appDataDir())
    const target = resolve(path)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error('Only the application data folder can be opened from the app.')
    }
    await shell.openPath(target)
  })

  ipcMain.handle('system:open-web-run', async (_event, applicationId: unknown, url: unknown) => {
    if (typeof applicationId !== 'number' || typeof url !== 'string') throw new Error('Invalid web run request')
    if (!container) throw new Error('Application is still starting')
    const application = getApplication(container.db, applicationId)
    if (!application || application.channel !== 'web') throw new Error('This application has no guided web form')
    if (!application.applyUrl || application.applyUrl !== url) throw new Error('The URL does not match the stored application')
    openWebApplicationWindow(url)
  })

  ipcMain.handle('system:export', async (_event, kind: unknown) => {
    if (!container) throw new Error('Application is still starting')
    if (kind !== 'jobs' && kind !== 'applications' && kind !== 'events' && kind !== 'outbox') {
      throw new Error('Unknown export kind')
    }
    return exportData(container, kind)
  })

  ipcMain.handle('system:choose-resume', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a resume file',
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, filePath: null }
    return { canceled: false, filePath: result.filePaths[0] }
  })
}

async function boot(): Promise<void> {
  createLogger({ dir: join(appDataDir(), 'logs'), level: isDev ? 'debug' : 'info', pretty: isDev })
  const logger = getLogger()
  logger.info({ version: appVersion, platform: process.platform }, 'starting BT Applicant')
  mkdirSync(appDataDir(), { recursive: true })
  applyCsp()
  registerSystemHandlers()

  container = new AppContainer({
    userDataDir: appDataDir(),
    version: appVersion,
    cipher,
    onChange: notifyChange,
    onDigest: notifyDigest
  })
  registerIpc(container, notifyChange)
  createWindow()
  container.start()
  logger.info({ db: container.paths.database }, 'database ready')
}

process.on('uncaughtException', (error) => {
  try {
    getLogger().error({ err: error }, 'uncaught exception')
  } catch {
    console.error(error)
  }
})

process.on('unhandledRejection', (reason) => {
  try {
    getLogger().error({ reason }, 'unhandled rejection')
  } catch {
    console.error(reason)
  }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(boot).catch((error) => {
    console.error('Failed to start BT Applicant', error)
    dialog.showErrorBox('BT Applicant could not start', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (stopStarted || !container) return
    event.preventDefault()
    stopStarted = true
    void container
      .stop()
      .catch((error) => getLogger().error({ err: error }, 'shutdown error'))
      .finally(() => app.quit())
  })
}

