import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useUiStore, applyTheme } from './stores/uiStore'
import { useTabsStore } from './stores/tabsStore'
import './styles/global.css'

async function bootstrap(): Promise<void> {
  try {
    const settings = await window.edgenotes.settings.get()
    useUiStore.getState().setSettings(settings)
    applyTheme(settings.theme)
    const power = await window.edgenotes.power.getState()
    useUiStore.getState().setPower(power)
    const dock = await window.edgenotes.window.getState()
    useUiStore.getState().setDockCollapsed(dock.collapsed)
  } catch {
    /* 使用默认主题继续启动 */
  }

  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

  void useTabsStore.getState().init()
}

void bootstrap()
