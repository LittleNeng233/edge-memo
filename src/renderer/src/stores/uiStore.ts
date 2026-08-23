import { create } from 'zustand'
import type { AppSettings, PowerState } from '@shared/types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface UiState {
  settings: AppSettings | null
  dockCollapsed: boolean
  power: PowerState | null
  shelfOpen: boolean
  settingsOpen: boolean
  toasts: Toast[]
  setSettings(s: AppSettings): void
  patchSettings(patch: Partial<AppSettings>): void
  setDockCollapsed(c: boolean): void
  setPower(p: PowerState): void
  setShelfOpen(open: boolean): void
  setSettingsOpen(open: boolean): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
}

let toastSeq = 1

export const useUiStore = create<UiState>((set, get) => ({
  settings: null,
  dockCollapsed: false,
  power: null,
  shelfOpen: false,
  settingsOpen: false,
  toasts: [],
  setSettings: (s) => set({ settings: s }),
  patchSettings: (patch) => {
    const cur = get().settings
    if (cur) set({ settings: { ...cur, ...patch } })
  },
  setDockCollapsed: (c) => set({ dockCollapsed: c }),
  setPower: (p) => set({ power: p }),
  setShelfOpen: (open) => set({ shelfOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), 3600)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export function applyTheme(theme: AppSettings['theme']): void {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const resolved = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme
  document.documentElement.dataset.theme = resolved
}
