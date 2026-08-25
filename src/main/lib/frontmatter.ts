import type { NoteMeta } from '@shared/types'

const FM_FIELDS = ['id', 'title', 'createdAt', 'updatedAt', 'order'] as const

export interface ParsedNote {
  meta: NoteMeta
  body: string
}

export function serializeNote(meta: NoteMeta, body: string): string {
  const lines = [
    '---',
    `id: ${meta.id}`,
    `title: ${meta.title.replace(/[\r\n]+/g, ' ')}`,
    `createdAt: ${meta.createdAt}`,
    `updatedAt: ${meta.updatedAt}`,
    `order: ${meta.order}`,
    '---',
    '',
    body
  ]
  return lines.join('\n')
}

export function parseNote(raw: string): ParsedNote {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { meta: emptyMeta(), body: normalized }
  }
  const end = normalized.indexOf('\n---\n', 4)
  const fmBody = end === -1 ? normalized.slice(4) : normalized.slice(4, end)
  const body = end === -1 ? '' : normalized.slice(end + 5).replace(/^\n+/, '')
  const meta = emptyMeta()
  for (const line of fmBody.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!(FM_FIELDS as readonly string[]).includes(key)) continue
    if (key === 'order') {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n)) meta.order = n
    } else if (key !== 'id' || value) {
      ;(meta as unknown as Record<string, string>)[key] = value
    }
  }
  return { meta, body }
}

function emptyMeta(): NoteMeta {
  return { id: '', title: '未命名笔记', createdAt: '', updatedAt: '', order: 0 }
}
