import { Menu, Tray, app, nativeImage, BrowserWindow } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { getResourcePath } from '../lib/paths'
import { log } from '../lib/logger'
import { getSleepBlockState, setSleepBlock } from '../services/powerService'
import { getSettings, updateSettings } from '../services/settings'

let tray: Tray | null = null

interface TrayActions {
  onToggle: () => void
  onExpand: () => void
  onCollapse: () => void
  onQuit: () => void
}

let actions: TrayActions | null = null

function buildIcon(): Electron.NativeImage {
  let icon = nativeImage.createFromPath(getResourcePath('tray.png'))
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(getResourcePath('icon.png'))
  }
  if (!icon.isEmpty() && icon.getSize().width > 32) {
    icon = icon.resize({ width: 32, height: 32 })
  }
  return icon
}

export function createTray(trayActions: TrayActions): Tray {
  actions = trayActions
  tray = new Tray(buildIcon())
  tray.setToolTip('EdgeMemo — 贴边笔记')
  tray.on('click', () => actions?.onToggle())
  rebuildMenu()
  return tray
}

export function rebuildTrayMenu(): void {
  rebuildMenu()
}

function rebuildMenu(): void {
  if (!tray || !actions) return
  const power = getSleepBlockState()
  const login = app.getLoginItemSettings()
  const template: MenuItemConstructorOptions[] = [
    { label: '展开 / 收起（点击图标同效）', click: () => actions?.onToggle() },
    { type: 'separator' },
    { label: '展开面板', click: () => actions?.onExpand() },
    { label: '收起为侧边', click: () => actions?.onCollapse() },
    { type: 'separator' },
    {
      label: '阻止系统自动休眠',
      type: 'checkbox',
      checked: power.enabled,
      click: (item) => {
        setSleepBlock(item.checked)
        updateSettings({ sleepBlockEnabled: item.checked })
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('settings:changed', getSettings())
        }
        rebuildMenu()
      }
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: login.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath })
        rebuildMenu()
      }
    },
    { type: 'separator' },
    { label: '退出 EdgeMemo', click: () => actions?.onQuit() }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

export function destroyTray(): void {
  try {
    tray?.destroy()
  } catch (err) {
    log('warn', `托盘销毁失败: ${String(err)}`)
  }
  tray = null
}
