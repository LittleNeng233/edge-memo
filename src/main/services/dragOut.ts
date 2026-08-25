import { nativeImage } from 'electron'
import type { BrowserWindow } from 'electron'
import { getResourcePath } from '../lib/paths'
import { resolveShelfFile } from './shelfStore'
import { log } from '../lib/logger'

export function startDragOut(win: BrowserWindow, id: string): void {
  const { absPath } = resolveShelfFile(id)
  let icon = nativeImage.createFromPath(getResourcePath('drag-icon.png'))
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(getResourcePath('icon.png'))
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty()
  }
  try {
    win.webContents.startDrag({ file: absPath, files: [absPath], icon })
  } catch (err) {
    log('error', `拖出失败: ${String(err)}`)
    throw new Error('启动拖拽失败', { cause: err })
  }
}
