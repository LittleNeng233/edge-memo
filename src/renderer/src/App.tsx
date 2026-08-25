import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useUiStore, applyTheme } from './stores/uiStore'
import { useTabsStore, countStats } from './stores/tabsStore'
import { useShelfStore } from './stores/shelfStore'
import brandUrl from './assets/brand.png'
import { TabBar } from './components/TabBar'
import { RichEditor } from './components/RichEditor'
import { Shelf } from './components/Shelf'
import { SettingsPanel } from './components/SettingsPanel'
import { PeekBar } from './components/PeekBar'
import { Toasts } from './components/Toast'

function HeaderBar(): JSX.Element {
  const setShelfOpen = useUiStore((s) => s.setShelfOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const power = useUiStore((s) => s.power)

  return (
    <header className="titlebar">
      <span className="brand" aria-hidden="true">
        <img className="brand-mark" src={brandUrl} alt="" draggable={false} />
        EdgeMemo
      </span>
      <div className="titlebar-actions">
        {power?.isBlocking && (
          <span className="power-chip" title="防休眠已开启（系统空闲不睡眠）">
            ⚡ 防休眠
          </span>
        )}
        <button
          className="icon-btn"
          onClick={() => setShelfOpen(true)}
          aria-label="打开暂存架"
          title="暂存架"
        >
          🗂
        </button>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="打开设置"
          title="设置"
        >
          ⚙
        </button>
        <button
          className="icon-btn collapse-btn"
          onClick={() => window.edgememo.window.collapse()}
          aria-label="收起为屏幕侧边"
          title="收起为侧边"
        >
          ⟫
        </button>
      </div>
    </header>
  )
}

function StatusBar(): JSX.Element {
  const active = useTabsStore((s) => s.tabs.find((t) => t.meta.id === s.activeId))
  const body = useTabsStore((s) => (s.activeId ? s.bodies[s.activeId] : '')) ?? ''
  // 全文统计较重，防抖 300ms，避免逐键触发多个正则扫描
  const [stats, setStats] = useState(() => countStats(body))

  useEffect(() => {
    const t = setTimeout(() => setStats(countStats(body)), 300)
    return () => clearTimeout(t)
  }, [body])

  if (!active) return <footer className="statusbar dim">就绪</footer>

  const savedLabel = active.saving
    ? '保存中…'
    : active.dirty
      ? '待保存'
      : active.savedAt
        ? `已保存 ${new Date(active.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '已同步'

  return (
    <footer className="statusbar">
      <span>{stats.words} 词 · {stats.chars} 字</span>
      <span className={`save-state${active.dirty ? ' is-dirty' : ''}${active.saving ? ' is-saving' : ''}`}>
        {savedLabel}
      </span>
    </footer>
  )
}

export default function App(): JSX.Element | null {
  const collapsed = useUiStore((s) => s.dockCollapsed)
  const theme = useUiStore((s) => s.settings?.theme ?? 'dark')
  const loading = useTabsStore((s) => s.loading)
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const newNote = useTabsStore((s) => s.newNote)
  const flushAll = useTabsStore((s) => s.flushAll)
  const setShelfOpen = useUiStore((s) => s.setShelfOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  const activeTab = tabs.find((t) => t.meta.id === activeId) ?? null
  // 挂载时快照：编辑器为非受控组件，正文变更走 bodies，不驱动 App 重渲染
  const activeInitialBody = activeTab
    ? (useTabsStore.getState().bodies[activeTab.meta.id] ?? '')
    : ''

  useEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      applyTheme(useUiStore.getState().settings?.theme ?? 'system')
    })
    const unbindDock = window.edgememo.onDockState((state) =>
      useUiStore.getState().setDockCollapsed(state.collapsed)
    )
    const unbindQuit = window.edgememo.onQuitRequest(() => {
      void flushAll().then((ok) => {
        if (ok) {
          window.edgememo.app.confirmQuit()
        } else {
          useUiStore.getState().toast('部分笔记保存失败，已取消退出，请重试', 'error')
        }
      })
    })
    const unbindSettings = window.edgememo.settings.onChange((s) => {
      useUiStore.getState().setSettings(s)
      applyTheme(s.theme)
      void window.edgememo.power
        .getState()
        .then(useUiStore.getState().setPower)
        .catch(() => {})
    })
    void useShelfStore.getState().refresh()
    return () => {
      unbindDock()
      unbindQuit()
      unbindSettings()
    }
  }, [flushAll])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void newNote()
      } else if (e.key === 'Escape') {
        setShelfOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newNote, setShelfOpen, setSettingsOpen])

  if (collapsed) {
    return (
      <>
        <PeekBar />
        <Toasts />
      </>
    )
  }

  return (
    <div className="app-shell">
      <HeaderBar />
      <TabBar />
      <main className="workspace">
        {activeTab ? (
          <>
            <div key={`flash-${activeTab.meta.id}`} className="workspace-flash" aria-hidden="true" />
            <RichEditor key={activeTab.meta.id} tabId={activeTab.meta.id} initialBody={activeInitialBody} />
          </>
        ) : (
          <div className="empty-hint workspace-empty">
            {loading ? '正在加载…' : (
              <>
                没有打开的笔记
                <button className="btn-primary" onClick={() => void newNote()}>
                  新建笔记
                </button>
              </>
            )}
          </div>
        )}
      </main>
      <StatusBar />
      <Shelf />
      <SettingsPanel />
      <Toasts />
    </div>
  )
}
