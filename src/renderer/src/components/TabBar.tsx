import { useEffect, useRef, useState } from 'react'
import { useTabsStore } from '../stores/tabsStore'

function TabItem({ id }: { id: string }): JSX.Element {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.meta.id === id))
  const activeId = useTabsStore((s) => s.activeId)
  const setActive = useTabsStore((s) => s.setActive)
  const closeTab = useTabsStore((s) => s.closeTab)
  const rename = useTabsStore((s) => s.rename)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!tab) return <></>

  const active = activeId === id

  const startEdit = (): void => {
    setDraft(tab.meta.title)
    setEditing(true)
  }

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== tab.meta.title) {
      void rename(id, draft)
    }
  }

  return (
    <div
      className={`tab${active ? ' is-active' : ''}`}
      onClick={() => setActive(id)}
      onDoubleClick={startEdit}
      onAuxClick={(e) => {
        if (e.button === 1) void closeTab(id)
      }}
      title={`${tab.meta.title}${tab.dirty ? '（未保存）' : ''}\n双击重命名`}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="tab-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onClick={(e) => e.stopPropagation()}
          maxLength={100}
          aria-label="重命名笔记"
        />
      ) : (
        <>
          <span className="tab-title">{tab.meta.title}</span>
          {(tab.dirty || tab.saving) && (
            <span className={`tab-dot${tab.saving ? ' is-saving' : ''}`} aria-hidden="true" />
          )}
        </>
      )}
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          void closeTab(id)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={`关闭 ${tab.meta.title}`}
        title="关闭标签"
      >
        ×
      </button>
    </div>
  )
}

export function TabBar(): JSX.Element {
  const ids = useTabsStore((s) => s.tabs.map((t) => t.meta.id).join('|'))
  const newNote = useTabsStore((s) => s.newNote)

  return (
    <div className="tabbar" role="tablist" aria-label="笔记标签">
      <div className="tabbar-scroll">
        {ids ? (
          ids.split('|').map((id) => <TabItem key={id} id={id} />)
        ) : (
          <span className="tabbar-empty">暂无打开的笔记</span>
        )}
      </div>
      <button
        className="icon-btn tab-new"
        onClick={() => {
          void newNote()
        }}
        aria-label="新建笔记"
        title="新建笔记（Ctrl+N）"
      >
        ＋
      </button>
    </div>
  )
}
