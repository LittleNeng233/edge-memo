import { app } from 'electron'
import { join } from 'node:path'
import { cpSync, existsSync, mkdirSync } from 'node:fs'

export interface AppDirs {
  root: string
  notes: string
  shelf: string
  media: string
  cache: string
  backup: string
  logs: string
}

let dirs: AppDirs | null = null

export function initDirs(): AppDirs {
  migrateLegacyUserData()
  const root = join(app.getPath('userData'), 'data')
  dirs = {
    root,
    notes: join(root, 'notes'),
    shelf: join(root, 'shelf'),
    media: join(root, 'media'),
    cache: join(root, 'cache'),
    backup: join(root, 'backup'),
    logs: join(root, 'logs')
  }
  for (const dir of Object.values(dirs)) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return dirs
}

export function getDirs(): AppDirs {
  if (!dirs) throw new Error('目录尚未初始化')
  return dirs
}

export function getResourcePath(name: string): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources')
  return join(base, name)
}

function migrateLegacyUserData(): void {
  const legacy = join(app.getPath('appData'), 'EdgeNotes')
  const current = app.getPath('userData')
  if (!existsSync(legacy) || existsSync(join(current, 'data'))) return
  try {
    cpSync(legacy, current, { recursive: true })
  } catch {
    /* 迁移失败则按全新目录启动 */
  }
}
