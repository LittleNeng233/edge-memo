import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { log } from '../lib/logger'

export const WINDOW_MIN_WIDTH = 260
export const WINDOW_MIN_HEIGHT = 360

let heartbeatTimer: NodeJS.Timeout | null = null
let blurReassertTimer: NodeJS.Timeout | null = null
let collapseHandler: (() => void) | null = null

export function setCollapseHandler(fn: () => void): void {
  collapseHandler = fn
}

export function createFloatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    frame: false,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#14161a',
    title: 'EdgeNotes',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenuBarVisibility(false)

  win.on('blur', () => {
    if (blurReassertTimer) clearTimeout(blurReassertTimer)
    blurReassertTimer = setTimeout(() => assertOnTop(win), 300)
  })

  win.on('close', (e) => {
    if (!(app as unknown as { __quitting?: boolean }).__quitting) {
      e.preventDefault()
      collapseHandler?.()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win
      .loadURL(process.env['ELECTRON_RENDERER_URL'])
      .catch((err) => log('error', `加载渲染层失败: ${String(err)}`))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch((err) => log('error', `加载渲染层失败: ${String(err)}`))
  }

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
      }
    })
  }

  startOnTopHeartbeat(win)
  return win
}

function assertOnTop(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (!win.isAlwaysOnTop()) {
    win.setAlwaysOnTop(true, 'screen-saver')
    log('info', '置顶层级被降级，已重新申明 screen-saver 层级')
  }
}

function startOnTopHeartbeat(win: BrowserWindow): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (win.isDestroyed()) {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = null
      return
    }
    assertOnTop(win)
  }, 4000)
}
