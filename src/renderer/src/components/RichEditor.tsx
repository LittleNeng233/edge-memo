import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent
} from 'react'
import { useTabsStore, plainTextOf } from '../stores/tabsStore'
import { useUiStore } from '../stores/uiStore'

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      } else if (name === 'srcset') {
        el.removeAttribute(attr.name)
      } else if (
        name === 'style' &&
        /(expression\s*\(|javascript\s*:|behavior\s*:|@import|url\s*\()/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name)
      }
    }
  })
  return doc.body.innerHTML
}

interface ToolbarAction {
  key: string
  label: string
  title: string
  cmd: string
  value?: string
}

const INLINE_ACTIONS: ToolbarAction[] = [
  { key: 'bold', label: 'B', title: '加粗（Ctrl+B）', cmd: 'bold' },
  { key: 'italic', label: 'I', title: '斜体（Ctrl+I）', cmd: 'italic' },
  { key: 'underline', label: 'U', title: '下划线（Ctrl+U）', cmd: 'underline' },
  { key: 'strikeThrough', label: 'S', title: '删除线', cmd: 'strikeThrough' }
]

const BLOCK_ACTIONS: ToolbarAction[] = [
  { key: 'h2', label: 'H2', title: '标题', cmd: 'formatBlock', value: 'h2' },
  { key: 'h3', label: 'H3', title: '小标题', cmd: 'formatBlock', value: 'h3' },
  { key: 'blockquote', label: '❝', title: '引用', cmd: 'formatBlock', value: 'blockquote' },
  { key: 'ul', label: '• ≡', title: '无序列表', cmd: 'insertUnorderedList' },
  { key: 'ol', label: '1. ≡', title: '有序列表', cmd: 'insertOrderedList' }
]

export interface RichEditorProps {
  tabId: string
  initialBody: string
}

export function RichEditor({ tabId, initialBody }: RichEditorProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const initialRef = useRef(initialBody)
  const draggingInternallyRef = useRef(false)
  const updateBody = useTabsStore((s) => s.updateBody)
  const setComposing = useTabsStore((s) => s.setComposing)
  const flushTab = useTabsStore((s) => s.flushTab)
  const toast = useUiStore((s) => s.toast)
  const [inlineOn, setInlineOn] = useState<Record<string, boolean>>({})
  const [blockTag, setBlockTag] = useState('')

  const refreshToolbar = useCallback((): void => {
    if (!ref.current) return
    const sel = window.getSelection()
    if (!sel || !sel.anchorNode || !ref.current.contains(sel.anchorNode)) return
    try {
      setInlineOn({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList')
      })
      const b = document.queryCommandValue('formatBlock')
      setBlockTag(typeof b === 'string' ? b.toLowerCase() : '')
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshToolbar)
    return () => document.removeEventListener('selectionchange', refreshToolbar)
  }, [refreshToolbar])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = initialRef.current
    if (!plainTextOf(initialRef.current).trim()) el.setAttribute('data-empty', 'true')
  }, [])

  const exec = useCallback((cmd: string, value?: string): void => {
    ref.current?.focus()
    document.execCommand(cmd, false, value)
    refreshToolbar()
  }, [refreshToolbar])

  const isEmptyNow = (): boolean => {
    const el = ref.current
    if (!el) return true
    return el.textContent?.trim() === '' && !el.querySelector('img')
  }

  const emitChange = useCallback((): void => {
    const el = ref.current
    if (!el) return
    if (isEmptyNow()) el.setAttribute('data-empty', 'true')
    else el.removeAttribute('data-empty')
    updateBody(tabId, el.innerHTML)
  }, [tabId, updateBody])

  const insertImageFile = useCallback(
    async (file: File): Promise<void> => {
      if (!ref.current) {
        toast('窗口已收起，无法插入图片，请重新操作', 'error')
        return
      }
      const ext = IMAGE_MIME_EXT[file.type]
      if (!ext) {
        toast('仅支持插入 PNG / JPG / GIF / WebP / BMP 图片', 'error')
        return
      }
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        const url = await window.edgenotes.media.saveNoteImage(tabId, data, ext)
        if (!ref.current) {
          toast('窗口在插入前已收起，本次插入已取消', 'error')
          return
        }
        exec('insertHTML', `<img src="${url}" alt="">`)
        emitChange()
        toast('已插入图片', 'success')
      } catch (err) {
        toast(`图片插入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [tabId, exec, emitChange, toast]
  )

  const insertImageFilesSequential = useCallback(
    async (files: File[]): Promise<void> => {
      for (const f of files) {
        await insertImageFile(f)
      }
    },
    [insertImageFile]
  )

  const upgradeRemoteImages = useCallback(async (): Promise<void> => {
    const el = ref.current
    if (!el) return
    const imgs = Array.from(el.querySelectorAll('img')).filter((im) =>
      /^https?:/i.test(im.getAttribute('src') || '')
    )
    for (const im of imgs) {
      const src = im.getAttribute('src')
      if (!src) continue
      try {
        const url = await window.edgenotes.media.importImage(src)
        im.setAttribute('src', url)
        im.removeAttribute('srcset')
      } catch {
        im.remove()
      }
    }
    if (imgs.length > 0) emitChange()
  }, [emitChange])

  const insertClipboardImage = useCallback(async (): Promise<boolean> => {
    try {
      const img = await window.edgenotes.clipboard.readImage()
      if (!img) return false
      if (!ref.current) {
        toast('窗口已收起，无法粘贴图片，请重新操作', 'error')
        return true
      }
      const url = await window.edgenotes.media.saveNoteImage(
        tabId,
        new Uint8Array(img.data),
        img.ext
      )
      if (!ref.current) {
        toast('窗口在插入前已收起，本次粘贴已取消', 'error')
        return true
      }
      exec('insertHTML', `<img src="${url}" alt="">`)
      emitChange()
      toast('已粘贴剪贴板图片', 'success')
      return true
    } catch (err) {
      toast(`图片粘贴失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    }
  }, [tabId, exec, emitChange, toast])

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    const dt = e.clipboardData
    const hasImageFile = Array.from(dt?.items ?? []).some(
      (it) => it.kind === 'file' && IMAGE_MIME_EXT[it.type]
    )
    if (hasImageFile) {
      e.preventDefault()
      void insertClipboardImage().then((done) => {
        if (!done && dt) {
          const f = Array.from(dt.files).find((x) => IMAGE_MIME_EXT[x.type])
          if (f) void insertImageFile(f)
        }
      })
      return
    }
    const html = dt?.getData('text/html')
    if (html) {
      e.preventDefault()
      exec('insertHTML', sanitizeHtml(html))
      emitChange()
      void upgradeRemoteImages()
      return
    }
    const text = dt?.getData('text/plain')
    if (text) {
      e.preventDefault()
      exec('insertText', text)
      emitChange()
    }
  }

  const onDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (draggingInternallyRef.current) {
      draggingInternallyRef.current = false
      return
    }
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) => IMAGE_MIME_EXT[f.type])
    if (files.length > 0) {
      void insertImageFilesSequential(files)
      return
    }
    const text = e.dataTransfer.getData('text/plain')
    if (text) {
      exec('insertText', text)
      emitChange()
    }
  }

  const onEditorClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!(e.ctrlKey || e.metaKey)) return
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href) return
    e.preventDefault()
    window.edgenotes.sys
      .openExternal(href)
      .catch((err) => toast(`打开链接失败：${err instanceof Error ? err.message : String(err)}`, 'error'))
  }

  return (
    <div className="editor-container">
      <div className="rt-toolbar" role="toolbar" aria-label="格式工具栏">
        {INLINE_ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`rt-btn rt-inline${inlineOn[a.key] ? ' is-active' : ''}`}
            title={a.title}
            aria-label={a.title}
            aria-pressed={!!inlineOn[a.key]}
            onMouseDown={(e) => {
              e.preventDefault()
              exec(a.cmd)
              emitChange()
            }}
          >
            {a.label}
          </button>
        ))}
        <span className="rt-sep" aria-hidden="true" />
        {BLOCK_ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`rt-btn${blockTag === a.value || inlineOn[a.key] ? ' is-active' : ''}`}
            title={a.title}
            aria-label={a.title}
            aria-pressed={blockTag === a.value || !!inlineOn[a.key]}
            onMouseDown={(e) => {
              e.preventDefault()
              if (a.cmd === 'formatBlock') {
                exec('formatBlock', blockTag === a.value ? 'p' : (a.value ?? 'p'))
              } else {
                exec(a.cmd)
              }
              emitChange()
            }}
          >
            {a.label}
          </button>
        ))}
        <span className="rt-sep" aria-hidden="true" />
        <button
          type="button"
          className="rt-btn"
          title="插入本地图片"
          aria-label="插入本地图片"
          onClick={() => fileRef.current?.click()}
        >
          🖼
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          multiple
          hidden
          onChange={(e) => {
            void insertImageFilesSequential(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <div
        ref={ref}
        className="rich-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="笔记内容"
        spellCheck={false}
        onInput={emitChange}
        onPaste={onPaste}
        onDrop={onDrop}
        onClick={onEditorClick}
        onDragStart={() => {
          draggingInternallyRef.current = true
        }}
        onDragEnd={() => {
          draggingInternallyRef.current = false
        }}
        onDragOver={(e) => e.preventDefault()}
        onCompositionStart={() => setComposing(tabId, true)}
        onCompositionEnd={() => {
          setComposing(tabId, false)
          emitChange()
        }}
        onBlur={() => void flushTab(tabId)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void flushTab(tabId).then((ok) => {
              toast(ok ? '已保存' : '保存失败，请重试', ok ? 'success' : 'error')
            })
          }
        }}
      />
    </div>
  )
}
