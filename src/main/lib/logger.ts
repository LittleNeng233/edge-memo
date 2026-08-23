import { appendFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { getDirs } from './paths'
import { join } from 'node:path'

const MAX_LOG_SIZE = 512 * 1024

export function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try {
    const file = join(getDirs().logs, 'main.log')
    if (existsSync(file) && statSync(file).size > MAX_LOG_SIZE) {
      unlinkSync(file)
    }
    appendFileSync(file, line, 'utf-8')
  } catch {
    /* 日志失败不影响主流程 */
  }
  if (level === 'error') console.error(line.trim())
  else console.log(line.trim())
}
