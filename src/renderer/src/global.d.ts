/// <reference types="vite/client" />
import type { EdgememoApi } from '@shared/api'

declare global {
  interface Window {
    edgememo: EdgememoApi
  }
}

export {}
