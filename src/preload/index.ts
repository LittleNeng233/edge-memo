import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppSettings, DockState } from '@shared/types'
import type { EdgememoApi } from '@shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: EdgememoApi = {
  note: {
    list: () => ipcRenderer.invoke('note:list'),
    open: (id) => ipcRenderer.invoke('note:open', id),
    create: (title) => ipcRenderer.invoke('note:create', title),
    save: (id, body) => ipcRenderer.invoke('note:save', id, body),
    rename: (id, title) => ipcRenderer.invoke('note:rename', id, title),
    remove: (id) => ipcRenderer.invoke('note:delete', id),
    autoBackup: (id, body) => ipcRenderer.invoke('note:auto-backup', id, body)
  },
  media: {
    saveNoteImage: (noteId, data, ext) =>
      ipcRenderer.invoke('media:save-note-image', noteId, data, ext),
    importImage: (src) => ipcRenderer.invoke('media:import-image', src)
  },
  clipboard: {
    readImage: () => ipcRenderer.invoke('clipboard:read-image')
  },
  shelf: {
    add: (paths) => ipcRenderer.invoke('shelf:add', paths),
    list: () => ipcRenderer.invoke('shelf:list'),
    remove: (id) => ipcRenderer.invoke('shelf:remove', id),
    dragOut: (id) => ipcRenderer.send('shelf:dragout', id),
    pathForFile: (file) => webUtils.getPathForFile(file),
    pasteImage: () => ipcRenderer.invoke('shelf:paste-image'),
    onDragError: (cb) =>
      subscribe<{ name: string; reason: string }>('shelf:drag-error', (info) => cb(info))
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    listDisplays: () => ipcRenderer.invoke('settings:displays'),
    onChange: (cb) => subscribe<AppSettings>('settings:changed', (s) => cb(s))
  },
  window: {
    collapse: () => ipcRenderer.send('window:collapse'),
    expand: () => ipcRenderer.send('window:expand'),
    toggle: () => ipcRenderer.send('window:toggle'),
    getState: () => ipcRenderer.invoke('window:get-state')
  },
  power: {
    getState: () => ipcRenderer.invoke('power:get-state')
  },
  sys: {
    openExternal: (url) => ipcRenderer.invoke('sys:open-external', url)
  },
  app: {
    confirmQuit: () => ipcRenderer.send('app:confirm-quit')
  },
  onDockState: (cb) => subscribe<DockState>('dock:state-changed', cb),
  onQuitRequest: (cb) => subscribe<void>('app:quit-request', () => cb())
}

contextBridge.exposeInMainWorld('edgememo', api)
