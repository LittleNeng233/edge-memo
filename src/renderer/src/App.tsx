import { useEffect } from 'react'
import { useUiStore, applyTheme } from './stores/uiStore'
import { useTabsStore, countStats } from './stores/tabsStore'
import { useShelfStore } from './stores/shelfStore'
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
        <svg className="brand-mark" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="bj-grad" x1="2" y1="4" x2="21" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: 'var(--accent-strong)' }} />
              <stop offset="1" style={{ stopColor: 'var(--accent-deep)' }} />
            </linearGradient>
          </defs>
          <rect x="2.2" y="6.4" width="3.2" height="11.2" rx="1.6" fill="url(#bj-grad)" />
          <path
            d="M9.4 4.4h6.4l4.2 4.2v10.8c0 .9-.7 1.6-1.6 1.6h-9c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6Z"
            fill="url(#bj-grad)"
            opacity="0.18"
          />
          <path
            d="M9.4 4.4h6.4l4.2 4.2v10.8c0 .9-.7 1.6-1.6 1.6h-9c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6Z"
            stroke="url(#bj-grad)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M15.8 4.4v3c0 .8.6 1.4 1.4 1.4h2.8" stroke="url(#bj-grad)" strokeWidth="1.2" />
          <path d="M12 11.6h5" stroke="url(#bj-grad)" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M12 15.2h3.4" stroke="url(#bj-grad)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
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
          onClick={() => window.edgenotes.window.collapse()}
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
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const active = tabs.find((t) => t.meta.id === activeId)

  if (!active) return <footer className="statusbar dim">就绪</footer>

  const { chars, words } = countStats(active.body)
  const savedLabel = active.saving
    ? '保存中…'
    : active.dirty
      ? '待保存'
      : active.savedAt
        ? `已保存 ${new Date(active.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '已同步'

  return (
    <footer className="statusbar">
      <span>{words} 词 · {chars} 字</span>
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

  useEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      applyTheme(useUiStore.getState().settings?.theme ?? 'system')
    })
    const unbindDock = window.edgenotes.onDockState((state) =>
      useUiStore.getState().setDockCollapsed(state.collapsed)
    )
    const unbindQuit = window.edgenotes.onQuitRequest(() => {
      void flushAll().then((ok) => {
        if (ok) {
          window.edgenotes.app.confirmQuit()
        } else {
          useUiStore.getState().toast('部分笔记保存失败，已取消退出，请重试', 'error')
        }
      })
    })
    const unbindSettings = window.edgenotes.settings.onChange((s) => {
      useUiStore.getState().setSettings(s)
      applyTheme(s.theme)
      void window.edgenotes.power
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
            <RichEditor key={activeTab.meta.id} tabId={activeTab.meta.id} initialBody={activeTab.body} />
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
