import type {
  AppSettings,
  ClipboardImage,
  DockState,
  DisplayInfo,
  NoteData,
  NoteMeta,
  PowerState,
  ShelfAddResult,
  ShelfItem
} from './types'

export interface EdgenotesApi {
  note: {
    list(): Promise<NoteMeta[]>
    open(id: string): Promise<NoteData>
    create(title?: string): Promise<NoteData>
    save(id: string, body: string): Promise<{ updatedAt: string }>
    rename(id: string, title: string): Promise<void>
    remove(id: string): Promise<void>
    autoBackup(id: string, body: string): Promise<void>
  }
  media: {
    saveNoteImage(noteId: string, data: Uint8Array, ext: string): Promise<string>
    importImage(src: string): Promise<string>
  }
  clipboard: {
    readImage(): Promise<ClipboardImage | null>
  }
  shelf: {
    add(paths: string[]): Promise<ShelfAddResult[]>
    list(): Promise<ShelfItem[]>
    remove(id: string): Promise<void>
    dragOut(id: string): void
    pathForFile(file: File): string
    pasteImage(): Promise<ShelfAddResult>
    onDragError(cb: (info: { name: string; reason: string }) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    listDisplays(): Promise<DisplayInfo[]>
    onChange(cb: (s: AppSettings) => void): () => void
  }
  window: {
    collapse(): void
    expand(): void
    toggle(): void
    getState(): Promise<DockState>
  }
  power: {
    getState(): Promise<PowerState>
  }
  sys: {
    openExternal(url: string): Promise<void>
  }
  app: {
    confirmQuit(): void
  }
  onDockState(cb: (state: DockState) => void): () => void
  onQuitRequest(cb: () => void): () => void
}
