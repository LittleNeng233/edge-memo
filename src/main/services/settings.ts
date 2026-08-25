import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, ThemeMode } from '@shared/types'
import { getDirs } from '../lib/paths'
import { writeFileAtomic } from '../lib/atomic'
import { log } from '../lib/logger'

const SETTINGS_FLUSH_MS = 400
let flushTimer: ReturnType<typeof setTimeout> | null = null

export const DEFAULT_SETTINGS: AppSettings = {
  sleepBlockEnabled: false,
  dockDisplayId: null,
  expandWidth: 420,
  expandHeightRatio: 0.72,
  peekHeightRatio: 0.6,
  peekOffsetRatio: null,
  theme: 'dark',
  autoCollapse: false,
  autoCollapseDelay: 700,
  lastCollapsed: false
}

let cached: AppSettings | null = null

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asNullableNum(v: unknown, fallback: number | null): number | null {
  if (v === null) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system']

const EXPAND_ABS_MAX = 7680

function normalize(raw: unknown): AppSettings {
  const s = (raw ?? {}) as Record<string, unknown>
  const theme = THEME_MODES.includes(s.theme as ThemeMode) ? (s.theme as ThemeMode) : DEFAULT_SETTINGS.theme
  return {
    sleepBlockEnabled: asBool(s.sleepBlockEnabled, DEFAULT_SETTINGS.sleepBlockEnabled),
    dockDisplayId:
      typeof s.dockDisplayId === 'number' && Number.isFinite(s.dockDisplayId)
        ? s.dockDisplayId
        : null,
    expandWidth: Math.min(
      EXPAND_ABS_MAX,
      Math.max(320, asNum(s.expandWidth, DEFAULT_SETTINGS.expandWidth))
    ),
    expandHeightRatio: Math.min(
      1,
      Math.max(0.4, asNum(s.expandHeightRatio, DEFAULT_SETTINGS.expandHeightRatio))
    ),
    peekHeightRatio: Math.min(
      1,
      Math.max(0.05, asNum(s.peekHeightRatio, DEFAULT_SETTINGS.peekHeightRatio))
    ),
    peekOffsetRatio: (() => {
      const v = asNullableNum(s.peekOffsetRatio, null)
      if (v === null) return null
      return Math.min(1, Math.max(0, v))
    })(),
    theme,
    autoCollapse: asBool(s.autoCollapse, DEFAULT_SETTINGS.autoCollapse),
    autoCollapseDelay: Math.min(
      3000,
      Math.max(500, Math.round(asNum(s.autoCollapseDelay, DEFAULT_SETTINGS.autoCollapseDelay)))
    ),
    lastCollapsed: asBool(s.lastCollapsed, DEFAULT_SETTINGS.lastCollapsed)
  }
}

export function loadSettings(): AppSettings {
  const file = join(getDirs().root, 'settings.json')
  let stored: unknown = {}
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      stored = {}
    }
  }
  cached = normalize(stored)
  return cached
}

export function getSettings(): AppSettings {
  if (!cached) loadSettings()
  return cached as AppSettings
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalize({ ...getSettings(), ...patch })
  cached = next
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushSettings()
    }, SETTINGS_FLUSH_MS)
  }
  return next
}

export function flushSettings(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!cached) return
  try {
    writeFileAtomic(join(getDirs().root, 'settings.json'), JSON.stringify(cached, null, 2))
  } catch (err) {
    log('warn', `设置写盘失败: ${String(err)}`)
  }
}
