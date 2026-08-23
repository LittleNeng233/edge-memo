import { create } from 'zustand'
import type { ShelfItem } from '@shared/types'
import { useUiStore } from './uiStore'

interface ShelfState {
  items: ShelfItem[]
  refresh(): Promise<void>
  add(paths: string[]): Promise<void>
  pasteImage(): Promise<void>
  remove(id: string): Promise<void>
}

export const useShelfStore = create<ShelfState>((set, get) => ({
  items: [],

  refresh: async () => {
    try {
      set({ items: await window.edgenotes.shelf.list() })
    } catch (err) {
      useUiStore
        .getState()
        .toast(`暂存架加载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  add: async (paths) => {
    if (!paths.length) return
    try {
      const results = await window.edgenotes.shelf.add(paths)
      await get().refresh()
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        useUiStore.getState().toast(`已暂存 ${results.length} 个文件`, 'success')
      } else if (failed.length === results.length) {
        useUiStore.getState().toast(`暂存失败：${failed[0].error ?? '未知错误'}`, 'error')
      } else {
        useUiStore.getState().toast(
          `已暂存 ${results.length - failed.length} 个，失败 ${failed.length} 个（${failed[0].error ?? ''}）`,
          'info'
        )
      }
    } catch (err) {
      useUiStore
        .getState()
        .toast(`暂存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  pasteImage: async () => {
    try {
      const result = await window.edgenotes.shelf.pasteImage()
      if (!result.ok) {
        useUiStore.getState().toast(`粘贴失败：${result.error ?? '未知错误'}`, 'error')
        return
      }
      await get().refresh()
      useUiStore.getState().toast(`已暂存「${result.item?.name ?? result.name}」`, 'success')
    } catch (err) {
      useUiStore
        .getState()
        .toast(`粘贴失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  },

  remove: async (id) => {
    try {
      await window.edgenotes.shelf.remove(id)
      set((s) => ({ items: s.items.filter((it) => it.id !== id) }))
    } catch (err) {
      useUiStore
        .getState()
        .toast(`移除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
}))

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
