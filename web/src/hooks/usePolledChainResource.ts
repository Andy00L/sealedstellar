import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChainError, Result } from '@/lib/errors'
import { POLL_INTERVAL_MS } from '@/config'

export type PolledResourceState<ResourceType> =
  | { phase: 'loading' }
  | { phase: 'ready'; value: ResourceType }
  | { phase: 'error'; error: ChainError; retryInSeconds: number }

// Shared polling primitive for chain reads: one fetch per ledger cadence,
// and on failure a live retry countdown instead of an infinite spinner
// (hi-fi RPC-down state). List and room views both wrap this.
export function usePolledChainResource<ResourceType>(
  fetchResource: () => Promise<Result<ResourceType, ChainError>>,
): { resourceState: PolledResourceState<ResourceType>; refreshNow: () => void } {
  const [resourceState, setResourceState] = useState<PolledResourceState<ResourceType>>({
    phase: 'loading',
  })
  const nextRetryAtRef = useRef<number>(0)

  const fetchOnce = useCallback(async () => {
    const fetched = await fetchResource()
    if (fetched.ok) {
      setResourceState({ phase: 'ready', value: fetched.value })
      return
    }
    nextRetryAtRef.current = Date.now() + POLL_INTERVAL_MS
    setResourceState({
      phase: 'error',
      error: fetched.error,
      retryInSeconds: Math.ceil(POLL_INTERVAL_MS / 1000),
    })
  }, [fetchResource])

  // external system: chain RPC polling plus its retry countdown; an
  // immediate first tick, one interval at the poll cadence, and one 1s
  // ticker that only updates the countdown while in the error phase. All
  // timers cleared on unmount. State updates happen inside timer callbacks
  // only (react-hooks/set-state-in-effect).
  useEffect(() => {
    const initialTickId = setTimeout(() => {
      void fetchOnce()
    }, 0)
    const pollIntervalId = setInterval(() => {
      void fetchOnce()
    }, POLL_INTERVAL_MS)
    const countdownIntervalId = setInterval(() => {
      setResourceState((currentState) => {
        if (currentState.phase !== 'error') {
          return currentState
        }
        const remainingSeconds = Math.max(
          0,
          Math.ceil((nextRetryAtRef.current - Date.now()) / 1000),
        )
        if (remainingSeconds === currentState.retryInSeconds) {
          return currentState
        }
        return { ...currentState, retryInSeconds: remainingSeconds }
      })
    }, 1000)
    return () => {
      clearTimeout(initialTickId)
      clearInterval(pollIntervalId)
      clearInterval(countdownIntervalId)
    }
  }, [fetchOnce])

  const refreshNow = useCallback(() => {
    setResourceState((currentState) =>
      currentState.phase === 'ready' ? currentState : { phase: 'loading' },
    )
    void fetchOnce()
  }, [fetchOnce])

  return { resourceState, refreshNow }
}
