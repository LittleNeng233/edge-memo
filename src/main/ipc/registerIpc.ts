import { BrowserWindow, ipcMain, shell } from 'electron'
import type { AppSettings, ThemeMode } from '@shared/types'
import {
  autoBackup,
  createNote,
  deleteNote,
  listNotes,
  openNote,
  renameNote,
  saveNote
} from '../services/noteStore'
import { addToShelf, listShelf, removeFromShelf, resolveShelfFile } from '../services/shelfStore'
import {
  importImageFromSource,
  pasteShelfImage,
  readClipboardImage,
  saveNoteImage
} from '../services/mediaStore'
import { startDragOut } from '../services/dragOut'
import { getSettings, updateSettings } from '../services/settings'
import { getSleepBlockState, setSleepBlock } from '../services/powerService'
import {
  applyLayout,
  collapse,
  expand,
  getDockState,
  listDisplaysForSettings,
  toggle
} from '../windows/dockEngine'
import { rebuildTrayMenu } from '../windows/tray'

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`参数 ${name} 必须为字符串`)
  return v
}

const THEMES: ThemeMode[] = ['dark', 'light', 'system']

export function registerIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('note:list', () => listNotes())

  ipcMain.handle('note:open', (_e, id: unknown) => openNote(asString(id, 'id')))

  ipcMain.handle('note:create', (_e, title?: unknown) =>
    createNote(typeof title === 'string' ? title : undefined)
  )

  ipcMain.handle('note:save', (_e, id: unknown, body: unknown) =>
    saveNote(asString(id, 'id'), asString(body, 'body'))
  )

  ipcMain.handle('note:rename', (_e, id: unknown, title: unknown) =>
    renameNote(asString(id, 'id'), asString(title, 'title'))
  )

  ipcMain.handle('note:delete', (_e, id: unknown) => deleteNote(asString(id, 'id')))

  ipcMain.handle('note:auto-backup', (_e, id: unknown, body: unknown) =>
    autoBackup(asString(id, 'id'), asString(body, 'body'))
  )

  ipcMain.handle('shelf:list', () => listShelf())

  ipcMain.handle('shelf:add', async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error('paths 必须为数组')
    return Promise.all(paths.slice(0, 50).map((p) => addToShelf(asString(p, 'path'))))
  })

  ipcMain.handle('shelf:remove', (_e, id: unknown) => removeFromShelf(asString(id, 'id')))

  ipcMain.handle('shelf:paste-image', () => pasteShelfImage())

  ipcMain.handle('clipboard:read-image', () => readClipboardImage())

  ipcMain.handle(
    'media:save-note-image',
    (_e, noteId: unknown, data: unknown, ext: unknown) => {
      if (!(data instanceof Uint8Array)) throw new Error('图片数据无效')
      return saveNoteImage(asString(noteId, 'noteId'), data, asString(ext, 'ext'))
    }
  )

  ipcMain.handle('media:import-image', (_e, src: unknown) =>
    importImageFromSource(asString(src, 'src'))
  )

  ipcMain.handle('sys:open-external', (_e, url: unknown) => {
    const u = asString(url, 'url')
    let parsed: URL
    try {
      parsed = new URL(u)
    } catch {
      throw new Error('链接无效')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅允许 http/https 链接')
    }
    return shell.openExternal(parsed.toString())
  })

  ipcMain.on('shelf:dragout', (e, id: unknown) => {
    const win = getWin()
    if (!win || win.webContents !== e.sender) return
    try {
      startDragOut(win, asString(id, 'id'))
    } catch {
      let name = ''
      try {
        name = resolveShelfFile(asString(id, 'id')).item.name
      } catch {
        name = String(id)
      }
      win.webContents.send('shelf:drag-error', { name, reason: '拖出失败，请重试' })
    }
  })

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', (_e, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('patch 无效')
    const input = patch as Partial<AppSettings>
    const next: Partial<AppSettings> = {}
    if (typeof input.sleepBlockEnabled === 'boolean') next.sleepBlockEnabled = input.sleepBlockEnabled
    if (input.dockDisplayId === null || typeof input.dockDisplayId === 'number') {
      next.dockDisplayId = input.dockDisplayId
    }
    if (typeof input.expandWidth === 'number' && Number.isFinite(input.expandWidth)) {
      next.expandWidth = input.expandWidth
    }
    if (typeof input.verticalRatio === 'number' && Number.isFinite(input.verticalRatio)) {
      next.verticalRatio = input.verticalRatio
    }
    if (typeof input.theme === 'string' && THEMES.includes(input.theme)) next.theme = input.theme
    if (typeof input.autoCollapse === 'boolean') next.autoCollapse = input.autoCollapse
    if (typeof input.autoCollapseDelay === 'number' && Number.isFinite(input.autoCollapseDelay)) {
      next.autoCollapseDelay = input.autoCollapseDelay
    }
    if (typeof input.peekHeightRatio === 'number' && Number.isFinite(input.peekHeightRatio)) {
      next.peekHeightRatio = input.peekHeightRatio
    }
    if (input.peekOffsetRatio === null) {
      next.peekOffsetRatio = null
    } else if (
      typeof input.peekOffsetRatio === 'number' &&
      Number.isFinite(input.peekOffsetRatio)
    ) {
      next.peekOffsetRatio = input.peekOffsetRatio
    }
    if (typeof input.lastCollapsed === 'boolean') next.lastCollapsed = input.lastCollapsed
    const prevSleep = getSettings().sleepBlockEnabled
    const saved = updateSettings(next)
    if (next.sleepBlockEnabled !== undefined && next.sleepBlockEnabled !== prevSleep) {
      setSleepBlock(saved.sleepBlockEnabled)
      rebuildTrayMenu()
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('settings:changed', saved)
      }
    }
    const touchesLayout =
      next.expandWidth !== undefined ||
      next.verticalRatio !== undefined ||
      next.peekHeightRatio !== undefined ||
      next.dockDisplayId !== undefined
    if (touchesLayout) applyLayout()
    return saved
  })

  ipcMain.handle('settings:displays', () => listDisplaysForSettings())

  ipcMain.on('window:collapse', () => collapse())
  ipcMain.on('window:expand', () => expand())
  ipcMain.on('window:toggle', () => toggle())
  ipcMain.handle('window:get-state', () => getDockState())

  ipcMain.handle('power:get-state', () => getSleepBlockState())
}
