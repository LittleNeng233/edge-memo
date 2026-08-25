import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DisplayInfo, ThemeMode } from '@shared/types'
import { useUiStore } from '../stores/uiStore'

export function SettingsPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const settings = useUiStore((s) => s.settings)
  const patchSettings = useUiStore((s) => s.patchSettings)
  const toast = useUiStore((s) => s.toast)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = useRef(0)

  useEffect(() => {
    if (open) {
      window.edgememo.settings.listDisplays().then(setDisplays).catch(() => setDisplays([]))
    }
  }, [open])

  if (!open || !settings) return null

  const apply = async (patch: Parameters<typeof patchSettings>[0], message?: string): Promise<void> => {
    try {
      const saved = await window.edgememo.settings.set(patch)
      useUiStore.getState().setSettings(saved)
      if (patch.sleepBlockEnabled !== undefined) {
        void window.edgememo.power
          .getState()
          .then(useUiStore.getState().setPower)
          .catch(() => {})
      }
      if (message) toast(message, 'success')
    } catch (err) {
      toast(`设置失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const applyLive = (patch: Parameters<typeof patchSettings>[0]): void => {
    patchSettings(patch)
    const now = Date.now()
    if (!pendingRef.current && now - lastSentRef.current >= 80) {
      lastSentRef.current = now
      void apply(patch)
      return
    }
    if (pendingRef.current) clearTimeout(pendingRef.current)
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null
      lastSentRef.current = Date.now()
      void apply(patch)
    }, 80)
  }
  const flushLive = (patch: Parameters<typeof patchSettings>[0]): void => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current)
      pendingRef.current = null
    }
    void apply(patch)
  }

  const themes: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: '深色' },
    { value: 'light', label: '浅色' },
    { value: 'system', label: '跟随系统' }
  ]

  const dockedDisplay =
    displays.find((d) => d.id === settings.dockDisplayId) ??
    displays.find((d) => d.isPrimary) ??
    null
  const workArea = dockedDisplay?.workArea ?? null
  const expandMax = Math.max(320, Math.floor((workArea?.width ?? 1440) / 2))
  const heightPx = workArea
    ? Math.round(Math.min(workArea.height - 24, Math.max(420, workArea.height * settings.expandHeightRatio)))
    : null

  return (
    <div className="modal-mask" onClick={() => setSettingsOpen(false)}>
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <h2>设置</h2>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
            ×
          </button>
        </header>

        <div className="settings-body">
          <div className="setting-row">
            <div className="setting-text">
              <label htmlFor="sleep-toggle">阻止系统自动休眠</label>
              <p className="dim">开启后系统空闲不睡眠（息屏与手动睡眠不受控），会增加耗电。</p>
            </div>
            <button
              id="sleep-toggle"
              className={`switch${settings.sleepBlockEnabled ? ' is-on' : ''}`}
              role="switch"
              aria-checked={settings.sleepBlockEnabled}
              onClick={() => void apply({ sleepBlockEnabled: !settings.sleepBlockEnabled })}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <label htmlFor="autocollapse-toggle">失焦自动收起</label>
              <p className="dim">点击其他窗口后，按下方设定的延时自动收起为侧边。</p>
            </div>
            <button
              id="autocollapse-toggle"
              className={`switch${settings.autoCollapse ? ' is-on' : ''}`}
              role="switch"
              aria-checked={settings.autoCollapse}
              onClick={() => void apply({ autoCollapse: !settings.autoCollapse })}
            >
              <span className="switch-knob" />
            </button>
          </div>

          {settings.autoCollapse && (
            <div className="setting-row column">
              <label htmlFor="delay-range">
                失焦收起延时 <b>{(settings.autoCollapseDelay / 1000).toFixed(1)} 秒</b>
              </label>
              <input
                id="delay-range"
                type="range"
                min={500}
                max={3000}
                step={100}
                value={settings.autoCollapseDelay}
                onChange={(e) => applyLive({ autoCollapseDelay: Number(e.target.value) })}
                onPointerUp={() => flushLive({ autoCollapseDelay: settings.autoCollapseDelay })}
                onKeyUp={() => flushLive({ autoCollapseDelay: settings.autoCollapseDelay })}
              />
              <p className="dim">失焦后等待多久收起，拖动即时生效。</p>
            </div>
          )}

          <div className="setting-row column">
            <label htmlFor="peek-range">
              贴边条长度 <b>{Math.round(settings.peekHeightRatio * 100)}%</b>
            </label>
            <input
              id="peek-range"
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(settings.peekHeightRatio * 100)}
              onChange={(e) => applyLive({ peekHeightRatio: Number(e.target.value) / 100 })}
              onPointerUp={() => flushLive({ peekHeightRatio: settings.peekHeightRatio })}
              onKeyUp={() => flushLive({ peekHeightRatio: settings.peekHeightRatio })}
            />
            <p className="dim">收起时贴边条占屏幕的高度比例，拖动即时生效。</p>
          </div>

          <div className="setting-row column">
            <label htmlFor="width-range">
              展开宽度 <b>{Math.min(settings.expandWidth, expandMax)}px</b>
            </label>
            <input
              id="width-range"
              type="range"
              min={320}
              max={expandMax}
              step={20}
              value={Math.min(settings.expandWidth, expandMax)}
              onChange={(e) => applyLive({ expandWidth: Number(e.target.value) })}
              onPointerUp={() => flushLive({ expandWidth: settings.expandWidth })}
              onKeyUp={() => flushLive({ expandWidth: settings.expandWidth })}
            />
            <p className="dim">
              展开后窗口的宽度，最小 320px，最大为屏幕宽度的一半（当前上限 {expandMax}px），拖动即时生效。
            </p>
          </div>

          <div className="setting-row column">
            <label htmlFor="height-range">
              展开高度 <b>{heightPx !== null ? `${heightPx}px` : `${Math.round(settings.expandHeightRatio * 100)}%`}</b>
            </label>
            <input
              id="height-range"
              type="range"
              min={40}
              max={100}
              step={5}
              value={Math.round(settings.expandHeightRatio * 100)}
              onChange={(e) => applyLive({ expandHeightRatio: Number(e.target.value) / 100 })}
              onPointerUp={() => flushLive({ expandHeightRatio: settings.expandHeightRatio })}
              onKeyUp={() => flushLive({ expandHeightRatio: settings.expandHeightRatio })}
            />
            <p className="dim">展开后窗口的高度，最大为屏幕高度，拖动即时生效。</p>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <label htmlFor="dock-select">停靠屏幕</label>
              <p className="dim">显示器被拔出时会自动回迁主屏。</p>
            </div>
            <select
              id="dock-select"
              value={settings.dockDisplayId ?? 'primary'}
              onChange={(e) => {
                const v = e.target.value
                void apply(
                  { dockDisplayId: v === 'primary' ? null : Number(v) },
                  '已切换停靠屏幕'
                )
              }}
            >
              <option value="primary">主屏（默认）</option>
              {displays
                .filter((d) => !d.isPrimary)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    副屏 · {d.label}
                  </option>
                ))}
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <label>主题</label>
            </div>
            <div className="segmented" role="radiogroup" aria-label="主题">
              {themes.map((th) => (
                <button
                  key={th.value}
                  role="radio"
                  aria-checked={settings.theme === th.value}
                  className={`segment${settings.theme === th.value ? ' is-active' : ''}`}
                  onClick={() => void apply({ theme: th.value })}
                >
                  {th.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="settings-foot dim">EdgeMemo v0.2.1 · 数据保存在 %APPDATA%\EdgeMemo\data\</footer>
      </section>
    </div>
  )
}
