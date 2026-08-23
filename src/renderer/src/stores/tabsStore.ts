import { create } from 'zustand'
import type { NoteData, NoteMeta } from '@shared/types'
import { useUiStore } from './uiStore'

export interface Tab {
  meta: NoteMeta
  body: string
  dirty: boolean
  saving: boolean
  savedAt: string | null
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  loading: boolean
  composingIds: Set<string>
  init(): Promise<void>
  openNote(id: string): Promise<void>
  newNote(title?: string): Promise<void>
  closeTab(id: string): Promise<void>
  removeNoteForever(id: string): Promise<void>
  setActive(id: string): void
  updateBody(id: string, body: string): void
  rename(id: string, title: string): Promise<void>
  setComposing(id: string, composing: boolean): void
  flushTab(id: string): Promise<boolean>
  flushAll(): Promise<boolean>
}

const OPEN_KEY = 'edgenotes.openTabs'
const ACTIVE_KEY = 'edgenotes.activeTab'

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activeSaveSeq: Record<string, number> = {}
const lastSavedBodies = new Map<string, string>()

function persistSession(tabs: Tab[], activeId: string | null): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(tabs.map((t) => t.meta.id)))
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

function toast(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  useUiStore.getState().toast(text, kind)
}

export function plainTextOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

async function saveTabNow(
  getState: () => TabsState,
  set: (partial: Partial<TabsState>) => void,
  id: string
): Promise<boolean> {
  const state = getState()
  const tab = state.tabs.find((t) => t.meta.id === id)
  if (!tab || !tab.dirty || tab.saving) return true
  const seq = (activeSaveSeq[id] ?? 0) + 1
  activeSaveSeq[id] = seq
  const bodyAtStart = tab.body
  const savedBody = lastSavedBodies.get(id)
  if (savedBody !== undefined && savedBody !== bodyAtStart) {
    const prevText = plainTextOf(savedBody).trim()
    const nextText = plainTextOf(bodyAtStart).trim()
    if (prevText.length >= 200 && nextText.length < 10) {
      void window.edgenotes.note.autoBackup(id, savedBody).catch(() => {})
      toast('检测到内容被大幅清空，原内容已自动备份', 'info')
    }
  }
  set({ tabs: state.tabs.map((t) => (t.meta.id === id ? { ...t, saving: true } : t)) })
  try {
    const { updatedAt } = await window.edgenotes.note.save(id, bodyAtStart)
    const cur = getState()
    const latest = cur.tabs.find((t) => t.meta.id === id)
    if (!latest || activeSaveSeq[id] !== seq) return true
    set({
      tabs: cur.tabs.map((t) =>
        t.meta.id === id
          ? { ...t, saving: false, savedAt: updatedAt, dirty: t.body !== bodyAtStart }
          : t
      )
    })
    lastSavedBodies.set(id, bodyAtStart)
    return true
  } catch (err) {
    const cur = getState()
    set({
      tabs: cur.tabs.map((t) => (t.meta.id === id ? { ...t, saving: false } : t))
    })
    toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return false
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  loading: true,
  composingIds: new Set<string>(),

  init: async () => {
    try {
      let metas: NoteMeta[] = await window.edgenotes.note.list()
      if (metas.length === 0) {
        const created = await window.edgenotes.note.create()
        metas = [created]
      }
      let openIds: string[] = []
      let activeId: string | null = null
      try {
        openIds = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') as string[]
        activeId = localStorage.getItem(ACTIVE_KEY)
      } catch {
        openIds = []
      }
      const validOpen = openIds.filter((id) => metas.some((m) => m.id === id))
      const finalIds = validOpen.length ? validOpen : [metas[0].id]
      const loadedResults = await Promise.all(
        finalIds.map(async (id): Promise<Tab | null> => {
          try {
            const data: NoteData = await window.edgenotes.note.open(id)
            return { meta: toMeta(data), body: data.body, dirty: false, saving: false, savedAt: null }
          } catch {
            return null
          }
        })
      )
      const loaded = loadedResults.filter((t): t is Tab => t !== null)
      if (loaded.length === 0) throw new Error('没有可打开的笔记')
      for (const t of loaded) lastSavedBodies.set(t.meta.id, t.body)
      const activeFinal =
        activeId && loaded.some((t) => t.meta.id === activeId)
          ? activeId
          : loaded[loaded.length - 1].meta.id
      set({ tabs: loaded, activeId: activeFinal, loading: false })
      persistSession(loaded, activeFinal)
    } catch (err) {
      set({ loading: false })
      toast(`笔记加载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  openNote: async (id) => {
    const exists = get().tabs.find((t) => t.meta.id === id)
    if (exists) {
      get().setActive(id)
      return
    }
    try {
      const data = await window.edgenotes.note.open(id)
      const tab: Tab = { meta: toMeta(data), body: data.body, dirty: false, saving: false, savedAt: null }
      lastSavedBodies.set(id, data.body)
      set((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
      persistSession(get().tabs, id)
    } catch (err) {
      toast(`打开笔记失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  newNote: async (title) => {
    try {
      const data = await window.edgenotes.note.create(title)
      const tab: Tab = { meta: toMeta(data), body: data.body, dirty: false, saving: false, savedAt: null }
      lastSavedBodies.set(tab.meta.id, data.body)
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.meta.id }))
      persistSession(get().tabs, tab.meta.id)
      toast('已新建笔记', 'success')
    } catch (err) {
      toast(`新建失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.meta.id === id)
    if (!tab) return
    if (tab.dirty && tab.body.trim()) {
      const ok = window.confirm(`「${tab.meta.title}」有未保存的修改，保存并关闭？\n（取消 = 放弃修改）`)
      if (ok) {
        const done = await get().flushTab(id)
        const still = get().tabs.find((t) => t.meta.id === id)
        if (still && still.dirty) {
          toast('保存未完成，已保留该标签页', 'error')
          return
        }
        if (!done && still) {
          toast('保存未完成，已保留该标签页', 'error')
          return
        }
      }
    }
    clearTimeout(saveTimers.get(id))
    saveTimers.delete(id)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.meta.id === id)
      const tabs = s.tabs.filter((t) => t.meta.id !== id)
      let activeId = s.activeId
      if (s.activeId === id) {
        activeId = tabs[Math.min(idx, tabs.length - 1)]?.meta.id ?? null
      }
      return { tabs, activeId }
    })
    persistSession(get().tabs, get().activeId)
  },

  removeNoteForever: async (id) => {
    try {
      clearTimeout(saveTimers.get(id))
      saveTimers.delete(id)
      lastSavedBodies.delete(id)
      await window.edgenotes.note.remove(id)
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.meta.id === id)
        const tabs = s.tabs.filter((t) => t.meta.id !== id)
        let activeId = s.activeId
        if (s.activeId === id) {
          activeId = tabs[Math.min(idx, tabs.length - 1)]?.meta.id ?? null
        }
        return { tabs, activeId }
      })
      persistSession(get().tabs, get().activeId)
      toast('已移入备份，可在数据目录找回', 'success')
    } catch (err) {
      toast(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  setActive: (id) => {
    set({ activeId: id })
    persistSession(get().tabs, id)
  },

  updateBody: (id, body) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.meta.id === id ? { ...t, body, dirty: true } : t))
    }))
    clearTimeout(saveTimers.get(id))
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id)
        if (get().composingIds.has(id)) {
          saveTimers.set(
            id,
            setTimeout(() => {
              saveTimers.delete(id)
              void saveTabNow(get, set, id)
            }, 300)
          )
          return
        }
        void saveTabNow(get, set, id)
      }, 1000)
    )
  },

  rename: async (id, title) => {
    const clean = title.trim() || '未命名笔记'
    set((s) => ({
      tabs: s.tabs.map((t) => (t.meta.id === id ? { ...t, meta: { ...t.meta, title: clean } } : t))
    }))
    try {
      await window.edgenotes.note.rename(id, clean)
    } catch (err) {
      toast(`重命名失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  setComposing: (id, composing) => {
    set((s) => {
      const next = new Set(s.composingIds)
      if (composing) next.add(id)
      else next.delete(id)
      return { composingIds: next }
    })
  },

  flushTab: async (id) => {
    clearTimeout(saveTimers.get(id))
    saveTimers.delete(id)
    return saveTabNow(get, set, id)
  },

  flushAll: async () => {
    const ids = get().tabs.filter((t) => t.dirty).map((t) => t.meta.id)
    ids.forEach((id) => {
      clearTimeout(saveTimers.get(id))
      saveTimers.delete(id)
    })
    const results = await Promise.allSettled(ids.map((id) => saveTabNow(get, set, id)))
    return results.every((r) => r.status === 'fulfilled' && r.value)
  }
}))

function toMeta(data: NoteData): NoteMeta {
  return {
    id: data.id,
    title: data.title,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    order: data.order
  }
}

export function countStats(body: string): { chars: number; words: number } {
  const text = plainTextOf(body)
  const chars = text.replace(/\s/g, '').length
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const latinWords = (
    text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9_'-]+/g) || []
  ).length
  return { chars, words: cjk + latinWords }
}
