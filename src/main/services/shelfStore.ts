import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ShelfAddResult, ShelfItem } from '@shared/types'
import { getDirs } from '../lib/paths'
import { writeFileAtomic } from '../lib/atomic'
import { log } from '../lib/logger'

const MAX_FILE_SIZE = 512 * 1024 * 1024
const RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const INVALID_NAME_CHARS_RE = /[<>:"/\\|?*]/

function sanitizeNameChars(raw: string): string {
  return Array.from(raw)
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code < 32 || code === 127 || INVALID_NAME_CHARS_RE.test(ch)) return '_'
      return ch
    })
    .join('')
}

function shelfIndexFile(): string {
  return join(getDirs().cache, 'shelf.json')
}

export function sanitizeFileName(raw: string): string {
  let name = sanitizeNameChars(raw).replace(/[.\s]+$/g, '')
  if (!name) name = 'file'
  if (RESERVED_NAME_RE.test(name.split('.')[0] === name ? name : name)) {
    name = `_${name}`
  }
  return name.slice(0, 200)
}

export function listShelf(): ShelfItem[] {
  const file = shelfIndexFile()
  if (!existsSync(file)) return []
  try {
    const items = JSON.parse(readFileSync(file, 'utf-8')) as ShelfItem[]
    if (!Array.isArray(items)) return []
    return items.filter((it) => it && typeof it.id === 'string')
  } catch {
    return []
  }
}

function saveShelf(items: ShelfItem[]): void {
  writeFileAtomic(shelfIndexFile(), JSON.stringify(items, null, 2))
}

function uniqueDestName(rawName: string): string {
  const destDir = getDirs().shelf
  let finalName = sanitizeFileName(rawName)
  let abs = join(destDir, finalName)
  let i = 1
  while (existsSync(abs)) {
    const d = finalName.lastIndexOf('.')
    const b = d > 0 ? finalName.slice(0, d) : finalName
    const e = d > 0 ? finalName.slice(d) : ''
    finalName = `${b}-${i++}${e}`
    abs = join(destDir, finalName)
  }
  return finalName
}

export async function addToShelf(srcPath: string): Promise<ShelfAddResult> {
  try {
    if (typeof srcPath !== 'string' || !srcPath.trim()) throw new Error('路径为空')
    const st = statSync(srcPath)
    if (!st.isFile()) throw new Error('仅支持文件（不支持文件夹）')
    if (st.size > MAX_FILE_SIZE) throw new Error('文件超过 512MB 上限')
    const rawName = srcPath.split(/[\\/]/).pop() || 'file'
    const dot = rawName.lastIndexOf('.')
    const ext = dot > 0 ? rawName.slice(dot + 1).toLowerCase() : ''
    const destDir = getDirs().shelf
    const finalName = uniqueDestName(rawName)
    await copyFile(srcPath, join(destDir, finalName))
    const item: ShelfItem = {
      id: randomUUID(),
      name: finalName,
      size: st.size,
      ext,
      addedAt: new Date().toISOString(),
      originPath: srcPath
    }
    saveShelf([...listShelf(), item])
    return { name: finalName, ok: true, item }
  } catch (err) {
    const name = typeof srcPath === 'string' ? srcPath.split(/[\\/]/).pop() || '?' : '?'
    log('warn', `暂存失败 ${name}: ${String(err)}`)
    return { name, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function addToShelfBuffer(rawName: string, data: Buffer): ShelfAddResult {
  try {
    const name = sanitizeFileName(rawName.trim() || 'file')
    if (!data || data.byteLength === 0) throw new Error('数据为空')
    if (data.byteLength > MAX_FILE_SIZE) throw new Error('文件超过 512MB 上限')
    const destDir = getDirs().shelf
    const finalName = uniqueDestName(name)
    writeFileSync(join(destDir, finalName), data)
    const dot = finalName.lastIndexOf('.')
    const ext = dot > 0 ? finalName.slice(dot + 1).toLowerCase() : ''
    const item: ShelfItem = {
      id: randomUUID(),
      name: finalName,
      size: data.byteLength,
      ext,
      addedAt: new Date().toISOString(),
      originPath: '剪贴板粘贴'
    }
    saveShelf([...listShelf(), item])
    return { name: finalName, ok: true, item }
  } catch (err) {
    log('warn', `剪贴板暂存失败 ${rawName}: ${String(err)}`)
    return { name: rawName, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function removeFromShelf(id: string): void {
  const items = listShelf()
  const target = items.find((it) => it.id === id)
  if (!target) return
  saveShelf(items.filter((it) => it.id !== id))
  try {
    rmSync(join(getDirs().shelf, target.name), { force: true })
  } catch (err) {
    log('warn', `暂存文件删除失败 ${target.name}: ${String(err)}`)
  }
}

export function resolveShelfFile(id: string): { absPath: string; item: ShelfItem } {
  const item = listShelf().find((it) => it.id === id)
  if (!item) throw new Error('条目不存在')
  const absPath = join(getDirs().shelf, item.name)
  if (!existsSync(absPath)) throw new Error('文件已丢失，请重新拖入')
  return { absPath, item }
}
