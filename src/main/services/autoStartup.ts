import { app } from 'electron'
import { join } from 'node:path'
import { log } from '../lib/logger'

/**
 * 应用开机自启（Windows 登录项）。
 * - 打包版：注册当前安装的 exe。
 * - 开发模式：注册 electron.exe 并附带项目路径参数，避免把裸 electron 或错误路径写入登录项。
 */
export function applyAutoStartup(enabled: boolean): boolean {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled })
    } else {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: [join(app.getAppPath(), '.')]
      })
    }
    return true
  } catch (err) {
    log('warn', `开机自启设置失败: ${String(err)}`)
    return false
  }
}