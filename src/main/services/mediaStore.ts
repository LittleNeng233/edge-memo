import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { clipboard, net } from 'electron'
import type { ClipboardImage, ShelfAddResult } from '@shared/types'
import { getDirs } from '../lib/paths'
import { writeFileAtomic } from '../lib/atomic'
import { log } from '../lib/logger'
import { addToShelfBuffer } from './shelfStore'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const MEDIA_NAME_RE = /^[0-9a-fA-F-]{8,64}\.(png|jpe?g|gif|webp|bmp)$/i
const FETCH_TIMEOUT_MS = 15000

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

function normalizeExt(ext: string): string {
  const clean = ext.toLowerCase().replace(/^\./, '')
  if (!IMAGE_EXTS.includes(clean)) return ''
  return clean === 'jpeg' ? 'jpg' : clean
}

function ensureMediaDir(): string {
  const dir = getDirs().media
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function writeImageFile(data: Uint8Array, realExt: string): string {
  const dir = ensureMediaDir()
  const name = `${randomUUID()}.${realExt}`
  writeFileAtomic(join(dir, name), Buffer.from(data))
  return `media://n/${name}`
}

export function saveNoteImage(noteId: string, data: Uint8Array, ext: string): string {
  if (!noteId || typeof noteId !== 'string') throw new Error('笔记 ID 无效')
  if (!data || data.byteLength === 0) throw new Error('图片数据为空')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB 上限')
  const realExt = normalizeExt(ext)
  if (!realExt) throw new Error('不支持的图片格式')
  return writeImageFile(data, realExt)
}

export async function importImageFromSource(src: string): Promise<string> {
  if (typeof src !== 'string' || src.length > 2048) throw new Error('图片地址无效')
  if (src.startsWith('data:image/')) {
    const comma = src.indexOf(',')
    const meta = src.slice(0, comma)
    const b64 = src.slice(comma + 1)
    const mime = /data:(image\/[a-z+]+)/i.exec(meta)?.[1] ?? ''
    const ext = MIME_EXT[mime]
    if (!ext) throw new Error('不支持的 Data URL 图片')
    const buf = Buffer.from(b64, 'base64')
    if (buf.byteLength === 0) throw new Error('图片数据为空')
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB 上限')
    return writeImageFile(new Uint8Array(buf), ext)
  }
  if (src.toLowerCase().startsWith('file://')) {
    let p: string
    try {
      p = decodeURIComponent(fileURLToPath(src))
    } catch {
      throw new Error('本地图片路径无效')
    }
    if (!existsSync(p)) throw new Error('本地图片不存在')
    const stat = statSync(p)
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB 上限')
    const ext = normalizeExt(p.split('.').pop() ?? '')
    if (!ext) throw new Error('不支持的本地图片格式')
    return writeImageFile(new Uint8Array(readFileSync(p)), ext)
  }
  if (!/^https?:\/\//i.test(src)) throw new Error('仅支持 http/https/data/file 图片')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await net.fetch(src, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    let ext = MIME_EXT[mime] ?? ''
    if (!ext) ext = normalizeExt(new URL(src).pathname.split('.').pop() ?? '')
    if (!ext) throw new Error('无法识别图片格式')
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0) throw new Error('图片数据为空')
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB 上限')
    return writeImageFile(buf, ext)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('下载超时（15 秒）', { cause: err })
    }
    throw err instanceof Error ? err : new Error(String(err), { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

export function resolveMediaPath(name: string): string | null {
  if (!MEDIA_NAME_RE.test(name)) return null
  const abs = join(getDirs().media, name)
  return existsSync(abs) ? abs : null
}

function isValidShelfName(name: string): boolean {
  if (!name || name.length > 120) return false
  return !Array.from(name).some((ch) => {
    const code = ch.charCodeAt(0)
    return code < 32 || code === 127 || /[\\/:*?"<>|]/.test(ch)
  })
}

export function resolveShelfPath(name: string): string | null {
  if (!isValidShelfName(name) || name === '.' || name === '..') return null
  const abs = join(getDirs().shelf, name)
  return existsSync(abs) ? abs : null
}

function collectRefsFromDir(dir: string, referenced: Set<string>): void {
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.md')) continue
    try {
      const content = readFileSync(join(dir, f), 'utf-8')
      for (const m of content.matchAll(/media:\/\/n\/([0-9a-fA-F-]{8,64}\.(?:png|jpe?g|gif|webp|bmp))/gi)) {
        referenced.add(m[1])
      }
    } catch {
      /* 跳过无法读取的文件 */
    }
  }
}

export function collectGarbageMedia(): number {
  try {
    const notesDir = getDirs().notes
    if (!existsSync(notesDir)) return 0
    const referenced = new Set<string>()
    // 备份中的笔记仍可恢复，其引用的图片必须保留
    collectRefsFromDir(notesDir, referenced)
    collectRefsFromDir(getDirs().backup, referenced)
    const mediaDir = getDirs().media
    if (!existsSync(mediaDir)) return 0
    const cutoff = Date.now() - 60 * 60 * 1000
    let removed = 0
    for (const f of readdirSync(mediaDir)) {
      if (!MEDIA_NAME_RE.test(f) || referenced.has(f)) continue
      try {
        const abs = join(mediaDir, f)
        if (statSync(abs).mtimeMs < cutoff) {
          unlinkSync(abs)
          removed += 1
        }
      } catch {
        /* 忽略单个文件失败 */
      }
    }
    if (removed > 0) log('info', `媒体垃圾回收：清理 ${removed} 个未引用文件`)
    return removed
  } catch (err) {
    log('warn', `媒体垃圾回收失败: ${String(err)}`)
    return 0
  }
}

const CLIPBOARD_IMAGE_TYPES: Array<{ mime: string; ext: string }> = [
  { mime: 'image/png', ext: 'png' },
  { mime: 'image/jpeg', ext: 'jpg' },
  { mime: 'image/bmp', ext: 'bmp' }
]

/** Electron 44 起 clipboard 为异步 W3C 风格 API，按 MIME 逐项探测 */
async function readClipboardImageBytes(): Promise<{ data: Uint8Array; ext: string } | null> {
  const items = await clipboard.read()
  for (const item of items) {
    for (const t of CLIPBOARD_IMAGE_TYPES) {
      if (!item.types.includes(t.mime)) continue
      try {
        const raw = await item.getType(t.mime)
        if (!(raw instanceof Blob)) continue
        return { data: new Uint8Array(await raw.arrayBuffer()), ext: t.ext }
      } catch {
        /* 该格式读取失败则继续探测 */
      }
    }
  }
  return null
}

export async function readClipboardImage(): Promise<ClipboardImage | null> {
  const img = await readClipboardImageBytes()
  if (!img || img.data.byteLength === 0) return null
  const copy = new ArrayBuffer(img.data.byteLength)
  new Uint8Array(copy).set(img.data)
  return { data: copy, ext: img.ext }
}

export async function pasteShelfImage(): Promise<ShelfAddResult> {
  try {
    const img = await readClipboardImageBytes()
    if (!img || img.data.byteLength === 0) {
      return { name: '剪贴板', ok: false, error: '剪贴板中没有图片' }
    }
    const buf = Buffer.from(img.data)
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return { name: '剪贴板', ok: false, error: '图片超过 20MB 上限' }
    }
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return addToShelfBuffer(`截图 ${stamp}.${img.ext}`, buf)
  } catch (err) {
    log('warn', `粘贴截图失败: ${String(err)}`)
    return { name: '剪贴板', ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
