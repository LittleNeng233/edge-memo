import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import type { DockState, DisplayInfo } from '@shared/types'
import { log } from '../lib/logger'
import { updateSettings, getSettings } from '../services/settings'

const PEEK_WIDTH = 8
const EXPAND_MIN = 320
const ANIM_LOCK_MS = 260

let win: BrowserWindow | null = null
let collapsed = false
let busyUntil = 0
let autoCollapseTimer: NodeJS.Timeout | null = null
let autoCollapseSuppressed = false
let initialized = false

/**
 * 模态对话框打开期间抑制失焦自动收起，
 * 避免确认框还挂在屏幕上时窗口先被收起。
 */
export function setAutoCollapseSuppressed(flag: boolean): void {
  autoCollapseSuppressed = flag
  if (flag && autoCollapseTimer) {
    clearTimeout(autoCollapseTimer)
    autoCollapseTimer = null
  }
}

export function initDockEngine(
  target: BrowserWindow,
  initialCollapsed: boolean,
  onAutoCollapseBlur: () => boolean
): void {
  win = target
  collapsed = initialCollapsed

  if (!initialized) {
    initialized = true
    screen.on('display-added', () => repositionSafely())
    screen.on('display-removed', (_e, removed) => onDisplayRemoved(removed))
    screen.on('display-metrics-changed', () => repositionSafely())
  }

  win.on('moved', () => onWindowMoved())
  win.on('resized', () => onWindowResized())

  win.webContents.on('did-finish-load', () => {
    if (collapsed) applyCollapsed()
    else applyExpanded()
    sendState()
    if (collapsed) win?.showInactive()
    else win?.show()
  })

  win.on('blur', () => {
    if (autoCollapseTimer) clearTimeout(autoCollapseTimer)
    if (autoCollapseSuppressed) return
    const delay = Math.min(3000, Math.max(500, getSettings().autoCollapseDelay))
    autoCollapseTimer = setTimeout(() => {
      if (onAutoCollapseBlur() && !collapsed && win && !win.isDestroyed() && !win.isFocused()) {
        collapse()
      }
    }, delay)
  })
  win.on('focus', () => {
    if (autoCollapseTimer) clearTimeout(autoCollapseTimer)
  })

  if (collapsed) {
    applyCollapsed()
    win.showInactive()
  }
}

function resolveDisplay(): Display {
  const settings = getSettings()
  if (settings.dockDisplayId !== null) {
    const found = screen.getAllDisplays().find((d) => d.id === settings.dockDisplayId)
    if (found) return found
    log('warn', `配置的停靠显示器 ${settings.dockDisplayId} 不存在，回迁主屏`)
    updateSettings({ dockDisplayId: null })
  }
  return screen.getPrimaryDisplay()
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function expandWidthLimit(wa: { width: number }): number {
  return Math.max(EXPAND_MIN, Math.floor(wa.width / 2))
}

function expandedBounds(disp: Display): Rect {
  const wa = disp.workArea
  const settings = getSettings()
  const width = Math.min(expandWidthLimit(wa), Math.max(EXPAND_MIN, settings.expandWidth))
  const height = Math.round(
    Math.min(wa.height - 24, Math.max(420, wa.height * settings.expandHeightRatio))
  )
  const freeSpace = Math.max(0, wa.height - height)
  return { x: wa.x + wa.width - width, y: wa.y + Math.round(freeSpace / 2), width, height }
}

function collapsedBounds(disp: Display): Rect {
  const wa = disp.workArea
  const settings = getSettings()
  const height = Math.round(wa.height * Math.min(1, Math.max(0.05, settings.peekHeightRatio)))
  const width = Math.max(4, Math.round(PEEK_WIDTH * disp.scaleFactor))
  const offset = settings.peekOffsetRatio
  const y =
    offset !== null
      ? wa.y + Math.round((wa.height - height) * Math.min(1, Math.max(0, offset)))
      : wa.y + Math.round((wa.height - height) / 2)
  return { x: wa.x + wa.width - width, y, width, height }
}

export function isCollapsed(): boolean {
  return collapsed
}

export function expand(): void {
  if (!win || win.isDestroyed() || !collapsed || isBusy()) return
  markBusy()
  collapsed = false
  updateSettings({ lastCollapsed: false })
  applyExpanded()
  win.show()
  sendState()
}

export function collapse(): void {
  if (!win || win.isDestroyed() || collapsed || isBusy()) return
  markBusy()
  collapsed = true
  updateSettings({ lastCollapsed: true })
  applyCollapsed()
  sendState()
}

export function toggle(): void {
  if (collapsed) expand()
  else collapse()
}

export function applyLayout(): void {
  if (!win || win.isDestroyed()) return
  markBusy()
  if (collapsed) applyCollapsed()
  else applyExpanded()
}

function applyExpanded(): void {
  if (!win || win.isDestroyed()) return
  const b = expandedBounds(resolveDisplay())
  try {
    win.setBounds(b)
    win.setMinimumSize(260, 360)
  } catch (err) {
    log('error', `展开定位失败: ${String(err)}`)
  }
}

function applyCollapsed(): void {
  if (!win || win.isDestroyed()) return
  const b = collapsedBounds(resolveDisplay())
  try {
    win.setMinimumSize(1, 1)
    win.setBounds(b)
  } catch (err) {
    log('error', `收起定位失败: ${String(err)}`)
  }
}

function markBusy(): void {
  busyUntil = Date.now() + ANIM_LOCK_MS
}

function isBusy(): boolean {
  return Date.now() < busyUntil
}

function sendState(): void {
  if (!win || win.isDestroyed()) return
  const state: DockState = { collapsed, displayId: resolveDisplay().id }
  win.webContents.send('dock:state-changed', state)
}

export function getDockState(): DockState {
  return { collapsed, displayId: resolveDisplay().id }
}

function clampAndSyncFromBounds(): void {
  if (!win || win.isDestroyed()) return
  const disp = resolveDisplay()
  const wa = disp.workArea
  const b = win.getBounds()

  const nearest = screen.getDisplayNearestPoint({ x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) })
  if (nearest.id !== disp.id) {
    updateSettings({ dockDisplayId: nearest.id === screen.getPrimaryDisplay().id ? null : nearest.id })
  }

  const target = collapsed ? collapsedBounds(nearest) : expandedBounds(nearest)

  if (!collapsed) {
    const width = Math.min(expandWidthLimit(wa), Math.max(EXPAND_MIN, b.width))
    const height = Math.min(wa.height - 24, Math.max(420, b.height))
    const heightRatio = Math.min(1, Math.max(0.4, height / wa.height))
    updateSettings({
      expandWidth: width,
      expandHeightRatio: Number(heightRatio.toFixed(4))
    })
  } else {
    const freeSpace = Math.max(0, wa.height - target.height)
    if (freeSpace > 0) {
      const ratio = Math.min(1, Math.max(0, (b.y - wa.y) / freeSpace))
      updateSettings({ peekOffsetRatio: Number(ratio.toFixed(4)) })
    }
  }

  const y = Math.min(target.y + (wa.height - target.height), Math.max(target.y, b.y))
  const patch: Rect = { x: target.x, y, width: target.width, height: target.height }
  if (patch.x !== b.x || Math.abs(patch.y - b.y) > 1) {
    markBusy()
    win.setBounds(patch)
  }
}

function onWindowMoved(): void {
  if (isBusy()) return
  clampAndSyncFromBounds()
}

function onWindowResized(): void {
  if (isBusy() || collapsed) return
  clampAndSyncFromBounds()
}

function repositionSafely(): void {
  if (!win || win.isDestroyed()) return
  try {
    markBusy()
    if (collapsed) applyCollapsed()
    else applyExpanded()
  } catch (err) {
    log('error', `显示器变化后重定位失败: ${String(err)}`)
  }
}

function onDisplayRemoved(_removed: Display): void {
  const settings = getSettings()
  const stillExists =
    settings.dockDisplayId === null ||
    screen.getAllDisplays().some((d) => d.id === settings.dockDisplayId)
  if (!stillExists) {
    log('warn', '停靠显示器被移除，悬浮条已回迁主屏')
    updateSettings({ dockDisplayId: null })
  }
  repositionSafely()
}

export function listDisplaysForSettings(): DisplayInfo[] {
  return screen.getAllDisplays().map((d: Display) => ({
    id: d.id,
    label: `${d.bounds.width}×${d.bounds.height}${d.scaleFactor !== 1 ? ` @${d.scaleFactor}x` : ''}`,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
    scaleFactor: d.scaleFactor,
    workArea: d.workArea
  }))
}
