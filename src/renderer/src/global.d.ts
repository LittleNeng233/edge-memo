/// <reference types="vite/client" />
import type { EdgenotesApi } from '@shared/api'

declare global {
  interface Window {
    edgenotes: EdgenotesApi
  }
}

export {}
