import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NoteData, NoteMeta } from '@shared/types'
import { getDirs } from '../lib/paths'
import { writeFileAtomic } from '../lib/atomic'
import { parseNote, serializeNote } from '../lib/frontmatter'
import { log } from '../lib/logger'
import { collectGarbageMedia, removeMediaFile } from './mediaStore'

const ID_RE = /^[0-9a-fA-F-]{8,64}$/
const MAX_BACKUPS = 50

let metasCache: NoteMeta[] | null = null
let cachedDirMtime = 0
let lastIndexJson = ''

function notePath(id: string): string {
  return join(getDirs().notes, `${id}.md`)
}

function assertId(id: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error('笔记 ID 无效')
  }
}

function readNoteFile(id: string): NoteData {
  const raw = readFileSync(notePath(id), 'utf-8')
  const { meta, body } = parseNote(raw)
  return {
    id: meta.id || id,
    title: meta.title || '未命名笔记',
    createdAt: meta.createdAt || new Date().toISOString(),
    updatedAt: meta.updatedAt || meta.createdAt || new Date().toISOString(),
    order: meta.order,
    body
  }
}

function sortMetas(metas: NoteMeta[]): NoteMeta[] {
  return metas.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

function scanNotes(): NoteMeta[] {
  const dir = getDirs().notes
  const metas: NoteMeta[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    try {
      const full = join(dir, name)
      const st = statSync(full)
      if (!st.isFile()) continue
      const { meta } = parseNote(readFileSync(full, 'utf-8'))
      metas.push({
        id: meta.id || name.slice(0, -3),
        title: meta.title || '未命名笔记',
        createdAt: meta.createdAt || st.birthtime.toISOString(),
        updatedAt: meta.updatedAt || meta.createdAt || st.mtime.toISOString(),
        order: meta.order
      })
    } catch (err) {
      log('warn', `扫描笔记失败 ${name}: ${String(err)}`)
    }
  }
  return sortMetas(metas)
}

function syncIndexCache(metas: NoteMeta[]): void {
  try {
    const json = JSON.stringify({ rebuiltAt: new Date().toISOString(), notes: metas })
    if (json === lastIndexJson) return
    lastIndexJson = json
    writeFileAtomic(join(getDirs().cache, 'notes.index.json'), json)
  } catch (err) {
    log('warn', `索引缓存写入失败: ${String(err)}`)
  }
}

export function listNotes(): NoteMeta[] {
  const dir = getDirs().notes
  let dirMtime = 0
  try {
    dirMtime = statSync(dir).mtimeMs
  } catch {
    /* 目录不存在时视为无变化 */
  }
  if (metasCache && dirMtime === cachedDirMtime) return metasCache
  metasCache = scanNotes()
  cachedDirMtime = dirMtime
  syncIndexCache(metasCache)
  return metasCache
}

function invalidateOnCreate(meta: NoteMeta): void {
  if (!metasCache) {
    listNotes()
    return
  }
  metasCache.push(meta)
  sortMetas(metasCache)
  syncIndexCache(metasCache)
  bumpDirStamp()
}

function invalidateOnUpdate(id: string, patch: Partial<NoteMeta>): void {
  if (!metasCache) return
  const it = metasCache.find((m) => m.id === id)
  if (!it) return
  Object.assign(it, patch)
  sortMetas(metasCache)
  syncIndexCache(metasCache)
}

function invalidateOnDelete(id: string): void {
  if (!metasCache) return
  metasCache = metasCache.filter((m) => m.id !== id)
  syncIndexCache(metasCache)
  bumpDirStamp()
}

function bumpDirStamp(): void {
  try {
    cachedDirMtime = statSync(getDirs().notes).mtimeMs
  } catch {
    cachedDirMtime = 0
  }
}

export function openNote(id: string): NoteData {
  assertId(id)
  return readNoteFile(id)
}

export function createNote(title?: string): NoteData {
  const metas = listNotes()
  const maxOrder = metas.length ? metas[metas.length - 1].order : 0
  const now = new Date().toISOString()
  const note: NoteData = {
    id: randomUUID(),
    title: title?.trim() || '未命名笔记',
    createdAt: now,
    updatedAt: now,
    order: maxOrder + 1,
    body: WELCOME_BODY
  }
  writeFileAtomic(notePath(note.id), serializeNote(note, note.body))
  invalidateOnCreate({ ...note })
  return note
}

export function saveNote(id: string, body: string): { updatedAt: string } {
  assertId(id)
  const existing = readNoteFile(id)
  const updatedAt = new Date().toISOString()
  const meta: NoteMeta = { ...existing, updatedAt }
  writeFileAtomic(notePath(id), serializeNote(meta, body))
  invalidateOnUpdate(id, { updatedAt })
  return { updatedAt }
}

export function renameNote(id: string, title: string): void {
  assertId(id)
  const clean = title.trim().replace(/\n/g, ' ').slice(0, 100) || '未命名笔记'
  const existing = readNoteFile(id)
  const updatedAt = new Date().toISOString()
  const meta: NoteMeta = { ...existing, title: clean, updatedAt }
  writeFileAtomic(notePath(id), serializeNote(meta, existing.body))
  invalidateOnUpdate(id, { title: clean, updatedAt })
}

export function autoBackup(id: string, body: string): void {
  assertId(id)
  if (typeof body !== 'string' || body.length === 0 || body.length > 5 * 1024 * 1024) {
    throw new Error('备份内容无效')
  }
  const existing = readNoteFile(id)
  const backupDir = getDirs().backup
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileAtomic(join(backupDir, `auto-${id}-${stamp}.md`), serializeNote(existing, body))
  pruneBackups()
}

function pruneBackups(): void {
  try {
    const backupDir = getDirs().backup
    if (!existsSync(backupDir)) return
    const files = readdirSync(backupDir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map((f) => {
        const abs = join(backupDir, f)
        return { abs, mtime: statSync(abs).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const f of files.slice(MAX_BACKUPS)) {
      try {
        unlinkSync(f.abs)
      } catch {
        /* 忽略单个失败 */
      }
    }
  } catch (err) {
    log('warn', `备份清理失败: ${String(err)}`)
  }
}

export function deleteNote(id: string): void {
  assertId(id)
  const src = notePath(id)
  if (!existsSync(src)) return
  let bodyMediaUrls: string[] = []
  try {
    const raw = readFileSync(src, 'utf-8')
    bodyMediaUrls = Array.from(raw.matchAll(/media:\/\/n\/[0-9a-fA-F-]{8,64}\.[a-z]+/gi)).map(
      (m) => m[0]
    )
  } catch {
    /* 读不到就跳过媒体清理 */
  }
  const backupDir = getDirs().backup
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
  let dest = join(backupDir, `${id}.md`)
  let i = 1
  while (existsSync(dest)) {
    dest = join(backupDir, `${id}-${i++}.md`)
  }
  renameSync(src, dest)
  invalidateOnDelete(id)
  for (const url of bodyMediaUrls) removeMediaFile(url)
  collectGarbageMedia()
  pruneBackups()
}

export function repairIndex(): void {
  const cacheFile = join(getDirs().cache, 'notes.index.json')
  try {
    rmSync(cacheFile, { force: true })
  } catch {
    /* 忽略 */
  }
  lastIndexJson = ''
  metasCache = null
  listNotes()
  log('info', '笔记索引已重建')
}

export function copyIntoShelf(srcPath: string, preferName?: string): { absPath: string; name: string } {
  if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
    throw new Error('源文件不存在或不是文件')
  }
  const shelfDir = getDirs().shelf
  if (!existsSync(shelfDir)) mkdirSync(shelfDir, { recursive: true })
  let name = preferName?.trim() || srcPath.split(/[\\/]/).pop() || 'file'
  let dest = join(shelfDir, name)
  let i = 1
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  while (existsSync(dest)) {
    name = `${base}-${i++}${ext}`
    dest = join(shelfDir, name)
  }
  copyFileSync(srcPath, dest)
  return { absPath: dest, name }
}

const WELCOME_BODY = [
  '<h2>欢迎使用 EdgeNotes 👋</h2>',
  '<p>我常驻在屏幕<strong>右侧边缘</strong>，收起后是一条细边，点击即可展开。</p>',
  '<h3>快速上手</h3>',
  '<ul>',
  '  <li>双击标签页标题可<strong>重命名</strong></li>',
  '  <li>顶部按钮可打开<strong>暂存架</strong>（拖入文件即可暂存，拖出为复制）</li>',
  '  <li>编辑器与暂存架都支持<strong>拖入图片</strong>或 <strong>Ctrl+V 粘贴截图</strong></li>',
  '  <li>设置里可调整<strong>贴边条长度 / 展开宽度 / 失焦收起延时</strong></li>',
  '</ul>',
  '<blockquote><p><strong>Ctrl+S</strong> 立即保存；编辑后 1 秒自动保存。开启「防休眠」后，系统空闲时不会自动睡眠（手动睡眠仍会生效）。</p></blockquote>'
].join('\n')
