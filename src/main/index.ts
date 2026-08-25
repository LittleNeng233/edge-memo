import { app, dialog, ipcMain, net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { createFloatWindow, setCollapseHandler } from './windows/floatWindow'
import type { BrowserWindow } from 'electron'
import {
  collapse,
  expand,
  initDockEngine,
  toggle
} from './windows/dockEngine'
import { createTray, destroyTray, rebuildTrayMenu } from './windows/tray'
import { registerIpc } from './ipc/registerIpc'
import { getSettings, loadSettings, flushSettings } from './services/settings'
import { setSleepBlock, stopSleepBlockOnQuit } from './services/powerService'
import { repairIndex } from './services/noteStore'
import { resolveMediaPath, resolveShelfPath, collectGarbageMedia } from './services/mediaStore'
import { initDirs } from './lib/paths'
import { log } from './lib/logger'

let mainWindow: BrowserWindow | null = null
let quitConfirmed = false

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function markQuitting(): void {
  ;(app as unknown as { __quitting?: boolean }).__quitting = true
}

function requestQuit(): void {
  if (quitConfirmed) return
  quitConfirmed = true
  // 先同步落盘设置，等待渲染层期间不丢数据
  flushSettings()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:quit-request')
    // 系统关机宽限约 5 秒，兜底等待压缩到 2 秒
    setTimeout(() => doQuit(), 2000)
  } else {
    doQuit()
  }
}

function doQuit(): void {
  markQuitting()
  flushSettings()
  stopSleepBlockOnQuit()
  app.quit()
}

function bootstrap(): void {
  app.setAppUserModelId('com.codexw.edgememo')

  process.on('uncaughtException', (err) => {
    log('error', `未捕获异常: ${err.stack || String(err)}`)
    try {
      dialog.showErrorBox('EdgeMemo 遇到错误', `${err.message}\n\n详情见日志文件。`)
    } catch {
      /* 忽略 */
    }
  })
  process.on('unhandledRejection', (reason) => {
    log('error', `未处理的 Promise 拒绝: ${String(reason)}`)
  })

  app.whenReady().then(() => {
    initDirs()
    const settings = loadSettings()
    repairIndex()
    collectGarbageMedia()

    protocol.handle('media', (request) => {
      try {
        const u = new URL(request.url)
        const name = decodeURIComponent(u.pathname.slice(1))
        const file = u.hostname === 's' ? resolveShelfPath(name) : resolveMediaPath(name)
        if (!file) return new Response(null, { status: 404 })
        return net.fetch(pathToFileURL(file).toString())
      } catch {
        return new Response(null, { status: 400 })
      }
    })

    mainWindow = createFloatWindow()
    registerIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
    ipcMain.on('app:confirm-quit', () => doQuit())

    setCollapseHandler(() => collapse())
    initDockEngine(
      mainWindow,
      settings.lastCollapsed,
      () => getSettings().autoCollapse
    )

    createTray({
      onToggle: () => toggle(),
      onExpand: () => expand(),
      onCollapse: () => collapse(),
      onQuit: () => requestQuit()
    })

    if (settings.sleepBlockEnabled) {
      setSleepBlock(true)
      rebuildTrayMenu()
    }

    // 托盘常驻进程可能长期不重启，定期回收未被笔记/备份引用的媒体文件
    const gcTimer = setInterval(() => collectGarbageMedia(), 6 * 60 * 60 * 1000)
    gcTimer.unref?.()

    log('info', 'EdgeMemo 已启动')
  })

  app.on('second-instance', () => {
    if (getSettings().lastCollapsed) {
      expand()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    /* 托盘常驻：不随窗口关闭退出 */
  })

  app.on('before-quit', (e) => {
    if (!quitConfirmed) {
      e.preventDefault()
      requestQuit()
    }
  })

  app.on('will-quit', () => {
    destroyTray()
  })
}
