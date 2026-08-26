export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  order: number
}

export interface NoteData extends NoteMeta {
  body: string
}

export interface ShelfItem {
  id: string
  name: string
  size: number
  ext: string
  addedAt: string
  originPath: string
}

export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppSettings {
  sleepBlockEnabled: boolean
  dockDisplayId: number | null
  expandWidth: number
  expandHeightRatio: number
  peekHeightRatio: number
  peekOffsetRatio: number | null
  theme: ThemeMode
  autoCollapse: boolean
  autoCollapseDelay: number
  lastCollapsed: boolean
  launchAtStartup: boolean
}

export interface ClipboardImage {
  data: ArrayBuffer
  ext: string
}

export interface DialogConfirmOptions {
  message: string
  detail?: string
  ok?: string
  cancel?: string
}

export interface DockState {
  collapsed: boolean
  displayId: number | null
}

export interface PowerState {
  enabled: boolean
  isBlocking: boolean
}

export interface DisplayInfo {
  id: number
  label: string
  isPrimary: boolean
  scaleFactor: number
  workArea: { x: number; y: number; width: number; height: number }
}

export interface ShelfAddResult {
  name: string
  ok: boolean
  error?: string
  item?: ShelfItem
}
