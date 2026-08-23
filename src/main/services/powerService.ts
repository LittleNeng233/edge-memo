import { powerSaveBlocker } from 'electron'
import type { PowerState } from '@shared/types'

let blockerId: number | null = null

export function setSleepBlock(enabled: boolean): PowerState {
  if (enabled && (blockerId === null || !powerSaveBlocker.isStarted(blockerId))) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!enabled && blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
  }
  return getPowerState(enabled)
}

function getPowerState(enabled: boolean): PowerState {
  const isBlocking = blockerId !== null && powerSaveBlocker.isStarted(blockerId)
  return { enabled, isBlocking }
}

export function getSleepBlockState(): PowerState {
  const enabled = blockerId !== null && powerSaveBlocker.isStarted(blockerId)
  return { enabled, isBlocking: enabled }
}

export function stopSleepBlockOnQuit(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
  }
}
