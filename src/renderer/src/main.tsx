import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useUiStore, applyTheme } from './stores/uiStore'
import { useTabsStore } from './stores/tabsStore'
import './styles/global.css'

async function bootstrap(): Promise<void> {
  try {
    const settings = await window.edgememo.settings.get()
    useUiStore.getState().setSettings(settings)
    applyTheme(settings.theme)
    const power = await window.edgememo.power.getState()
    useUiStore.getState().setPower(power)
    const dock = await window.edgememo.window.getState()
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
