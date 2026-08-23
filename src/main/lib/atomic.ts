import { renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  const tmp = join(dirname(file), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  try {
    if (typeof data === 'string') writeFileSync(tmp, data, 'utf-8')
    else writeFileSync(tmp, data)
    renameSync(tmp, file)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件可能不存在 */
    }
    throw err
  }
}
