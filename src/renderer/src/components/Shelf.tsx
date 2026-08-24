import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import { useShelfStore, formatSize } from '../stores/shelfStore'
import { useUiStore } from '../stores/uiStore'

const EXT_ICONS: Record<string, string> = {
  md: '📝',
  txt: '📄',
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  xls: '📗',
  xlsx: '📗',
  ppt: '📙',
  pptx: '📙',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  webp: '🖼️',
  svg: '🖼️',
  zip: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
  mp3: '🎵',
  wav: '🎵',
  mp4: '🎬',
  mov: '🎬',
  exe: '⚙️',
  js: '📜',
  ts: '📜',
  tsx: '📜',
  py: '🐍',
  json: '🧾'
}

function extIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_ICONS[ext] ?? '📦'
}

function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)
}

export function Shelf(): JSX.Element | null {
  const open = useUiStore((s) => s.shelfOpen)
  const setShelfOpen = useUiStore((s) => s.setShelfOpen)
  const items = useShelfStore((s) => s.items)
  const add = useShelfStore((s) => s.add)
  const pasteImage = useShelfStore((s) => s.pasteImage)
  const remove = useShelfStore((s) => s.remove)
  const toast = useUiStore((s) => s.toast)
  const [dragOver, setDragOver] = useState(false)
  const [thumbErrors, setThumbErrors] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const unbind = window.edgememo.shelf.onDragError((info) => {
      useUiStore.getState().toast(`「${info.name}」${info.reason}`, 'error')
    })
    return unbind
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      void pasteImage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pasteImage])

  if (!open) return null

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) {
      toast('仅支持拖入本地文件（网页元素无法暂存）', 'info')
      return
    }
    const paths: string[] = []
    for (const f of files) {
      try {
        const p = window.edgememo.shelf.pathForFile(f)
        if (p) paths.push(p)
      } catch {
        /* 无法取路径的项跳过 */
      }
    }
    if (paths.length === 0) {
      toast('未能读取文件路径，请从资源管理器拖入', 'error')
      return
    }
    void add(paths)
  }

  return (
    <aside
      className={`shelf-drawer${dragOver ? ' is-dragover' : ''}`}
      role="dialog"
      aria-label="文件暂存架"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <header className="shelf-head">
        <h2>暂存架</h2>
        <span className="shelf-count">{items.length} 个文件</span>
        <button className="icon-btn" onClick={() => setShelfOpen(false)} aria-label="关闭暂存架">
          ×
        </button>
      </header>

      {items.length === 0 ? (
        <div className="shelf-empty">
          <div className="shelf-empty-icon">🗂️</div>
          <p>把文件或图片拖到这里暂存</p>
          <p className="dim">截图后按 Ctrl+V 可直接粘贴进暂存架</p>
        </div>
      ) : (
        <div className="shelf-grid">
          {items.map((it) => (
            <div
              key={it.id}
              className="shelf-tile"
              draggable
              title={`${it.name}\n${formatSize(it.size)}\n来自：${it.originPath}\n按住拖出为复制`}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('application/edgememo-shelf', it.id)
                window.edgememo.shelf.dragOut(it.id)
              }}
            >
              <span className="shelf-tile-icon" aria-hidden="true">
                {extIcon(it.name)}
              </span>
              {isImageFile(it.name) && !thumbErrors[it.id] ? (
                <img
                  className="shelf-tile-thumb"
                  src={`media://s/${encodeURIComponent(it.name)}`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={() => setThumbErrors((m) => ({ ...m, [it.id]: true }))}
                />
              ) : null}
              <span className="shelf-tile-name">{it.name}</span>
              <span className="shelf-tile-size">{formatSize(it.size)}</span>
              <button
                className="shelf-tile-remove"
                onClick={() => void remove(it.id)}
                aria-label={`移除 ${it.name}`}
                title="从暂存架移除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <footer className="shelf-foot">
        拖入文件 / 图片暂存 · Ctrl+V 粘贴截图 · 拖出为复制
      </footer>
    </aside>
  )
}
