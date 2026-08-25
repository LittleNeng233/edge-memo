import { create } from 'zustand'
import type { NoteData, NoteMeta } from '@shared/types'
import { useUiStore } from './uiStore'

export interface Tab {
  meta: NoteMeta
  dirty: boolean
  saving: boolean
  savedAt: string | null
}

interface TabsState {
  tabs: Tab[]
  bodies: Record<string, string>
  activeId: string | null
  loading: boolean
  composingIds: Set<string>
  init(): Promise<void>
  openNote(id: string): Promise<void>
  newNote(title?: string): Promise<void>
  closeTab(id: string): Promise<void>
  removeNoteForever(id: string): Promise<void>
  setActive(id: string): void
  reorder(fromId: string, toId: string, place: 'before' | 'after'): void
  updateBody(id: string, body: string): void
  rename(id: string, title: string): Promise<void>
  setComposing(id: string, composing: boolean): void
  flushTab(id: string): Promise<boolean>
  flushAll(): Promise<boolean>
}

const OPEN_KEY = 'edgememo.openTabs'
const ACTIVE_KEY = 'edgememo.activeTab'
const LEGACY_OPEN_KEY = 'edgenotes.openTabs'
const LEGACY_ACTIVE_KEY = 'edgenotes.activeTab'

function migrateLegacyKeys(): void {
  try {
    if (localStorage.getItem(OPEN_KEY) === null && localStorage.getItem(LEGACY_OPEN_KEY) !== null) {
      localStorage.setItem(OPEN_KEY, localStorage.getItem(LEGACY_OPEN_KEY) as string)
    }
    if (localStorage.getItem(ACTIVE_KEY) === null && localStorage.getItem(LEGACY_ACTIVE_KEY) !== null) {
      localStorage.setItem(ACTIVE_KEY, localStorage.getItem(LEGACY_ACTIVE_KEY) as string)
    }
    localStorage.removeItem(LEGACY_OPEN_KEY)
    localStorage.removeItem(LEGACY_ACTIVE_KEY)
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
migrateLegacyKeys()

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
  const bodyAtStart = state.bodies[id] ?? ''
  const savedBody = lastSavedBodies.get(id)
  if (savedBody !== undefined && savedBody !== bodyAtStart) {
    const prevText = plainTextOf(savedBody).trim()
    const nextText = plainTextOf(bodyAtStart).trim()
    if (prevText.length >= 200 && nextText.length < 10) {
      const ok = await window.edgememo.dialog.confirm({
        message: '检测到笔记内容被大幅清空。',
        detail: '是否备份清空前的原内容？\n（备份保存到数据目录 backup 文件夹）',
        ok: '备份原内容',
        cancel: '继续保存'
      })
      if (ok) {
        try {
          await window.edgememo.note.autoBackup(id, savedBody)
          toast('已备份清空前的原内容', 'success')
        } catch {
          toast('备份失败：内容已正常保存', 'error')
        }
      }
    }
  }
  set({ tabs: state.tabs.map((t) => (t.meta.id === id ? { ...t, saving: true } : t)) })
  try {
    const { updatedAt } = await window.edgememo.note.save(id, bodyAtStart)
    const cur = getState()
    const latest = cur.tabs.find((t) => t.meta.id === id)
    if (!latest || activeSaveSeq[id] !== seq) return true
    set({
      tabs: cur.tabs.map((t) =>
        t.meta.id === id
          ? { ...t, saving: false, savedAt: updatedAt, dirty: cur.bodies[id] !== bodyAtStart }
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
  bodies: {},
  activeId: null,
  loading: true,
  composingIds: new Set<string>(),

  init: async () => {
    try {
      let metas: NoteMeta[] = await window.edgememo.note.list()
      if (metas.length === 0) {
        const created = await window.edgememo.note.create()
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
        finalIds.map(async (id): Promise<{ meta: NoteMeta; body: string } | null> => {
          try {
            const data: NoteData = await window.edgememo.note.open(id)
            return { meta: toMeta(data), body: data.body }
          } catch {
            return null
          }
        })
      )
      const loaded = loadedResults.filter(
        (t): t is { meta: NoteMeta; body: string } => t !== null
      )
      if (loaded.length === 0) throw new Error('没有可打开的笔记')
      const tabs: Tab[] = []
      const bodies: Record<string, string> = {}
      for (const t of loaded) {
        tabs.push({ meta: t.meta, dirty: false, saving: false, savedAt: null })
        bodies[t.meta.id] = t.body
        lastSavedBodies.set(t.meta.id, t.body)
      }
      const activeFinal =
        activeId && tabs.some((t) => t.meta.id === activeId)
          ? activeId
          : tabs[tabs.length - 1].meta.id
      set({ tabs, bodies, activeId: activeFinal, loading: false })
      persistSession(tabs, activeFinal)
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
      const data = await window.edgememo.note.open(id)
      const tab: Tab = { meta: toMeta(data), dirty: false, saving: false, savedAt: null }
      lastSavedBodies.set(id, data.body)
      set((s) => ({
        tabs: [...s.tabs, tab],
        bodies: { ...s.bodies, [id]: data.body },
        activeId: id
      }))
      persistSession(get().tabs, id)
    } catch (err) {
      toast(`打开笔记失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  newNote: async (title) => {
    try {
      const data = await window.edgememo.note.create(title)
      const tab: Tab = { meta: toMeta(data), dirty: false, saving: false, savedAt: null }
      lastSavedBodies.set(tab.meta.id, data.body)
      set((s) => ({
        tabs: [...s.tabs, tab],
        bodies: { ...s.bodies, [tab.meta.id]: data.body },
        activeId: tab.meta.id
      }))
      persistSession(get().tabs, tab.meta.id)
      toast('已新建笔记', 'success')
    } catch (err) {
      toast(`新建失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.meta.id === id)
    if (!tab) return
    if (tab.dirty && (get().bodies[id] ?? '').trim()) {
      const ok = await window.edgememo.dialog.confirm({
        message: `「${tab.meta.title}」有未保存的修改`,
        detail: '保存并关闭？放弃则不保留本次修改。',
        ok: '保存并关闭',
        cancel: '放弃修改'
      })
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
    lastSavedBodies.delete(id)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.meta.id === id)
      const tabs = s.tabs.filter((t) => t.meta.id !== id)
      const bodies = { ...s.bodies }
      delete bodies[id]
      let activeId = s.activeId
      if (s.activeId === id) {
        activeId = tabs[Math.min(idx, tabs.length - 1)]?.meta.id ?? null
      }
      return { tabs, bodies, activeId }
    })
    persistSession(get().tabs, get().activeId)
  },

  removeNoteForever: async (id) => {
    try {
      clearTimeout(saveTimers.get(id))
      saveTimers.delete(id)
      lastSavedBodies.delete(id)
      await window.edgememo.note.remove(id)
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.meta.id === id)
        const tabs = s.tabs.filter((t) => t.meta.id !== id)
        const bodies = { ...s.bodies }
        delete bodies[id]
        let activeId = s.activeId
        if (s.activeId === id) {
          activeId = tabs[Math.min(idx, tabs.length - 1)]?.meta.id ?? null
        }
        return { tabs, bodies, activeId }
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

  reorder: (fromId, toId, place) => {
    const s = get()
    const from = s.tabs.findIndex((t) => t.meta.id === fromId)
    const to = s.tabs.findIndex((t) => t.meta.id === toId)
    if (from < 0 || to < 0 || fromId === toId) return
    const tabs = s.tabs.slice()
    const [moved] = tabs.splice(from, 1)
    const anchor = tabs.findIndex((t) => t.meta.id === toId)
    tabs.splice(place === 'before' ? anchor : anchor + 1, 0, moved)
    set({ tabs })
    persistSession(tabs, s.activeId)
  },

  updateBody: (id, body) => {
    set((s) => {
      // 正文存于 bodies：只有 dirty 翻转时才替换 tabs 引用，避免逐键全树重渲染
      let touched = false
      const tabs = s.tabs.map((t) => {
        if (t.meta.id === id && !t.dirty) {
          touched = true
          return { ...t, dirty: true }
        }
        return t
      })
      return { bodies: { ...s.bodies, [id]: body }, tabs: touched ? tabs : s.tabs }
    })
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
      await window.edgememo.note.rename(id, clean)
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
