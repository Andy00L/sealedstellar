import { useCallback, useEffect, useRef, useState } from 'react'

import { listAuctions, type AuctionView } from '@/lib/chain'
import { POLL_INTERVAL_MS } from '@/config'

export type AuctionsListState =
  | { phase: 'loading' }
  | { phase: 'ready'; auctions: AuctionView[] }
  | { phase: 'error'; retryInSeconds: number }

// Polls the auction list once per ledger cadence. On RPC failure the poll
// keeps running and the UI shows a live retry countdown instead of an
// infinite spinner (hi-fi RPC-down state).
export function useAuctionsList(): { listState: AuctionsListState; refreshNow: () => void } {
  const [listState, setListState] = useState<AuctionsListState>({ phase: 'loading' })
  const nextRetryAtRef = useRef<number>(0)

  const fetchOnce = useCallback(async () => {
    const fetched = await listAuctions()
    if (fetched.ok) {
      setListState({ phase: 'ready', auctions: fetched.value })
      return
    }
    nextRetryAtRef.current = Date.now() + POLL_INTERVAL_MS
    setListState({
      phase: 'error',
      retryInSeconds: Math.ceil(POLL_INTERVAL_MS / 1000),
    })
  }, [])

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
      setListState((currentState) => {
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
        return { phase: 'error', retryInSeconds: remainingSeconds }
      })
    }, 1000)
    return () => {
      clearTimeout(initialTickId)
      clearInterval(pollIntervalId)
      clearInterval(countdownIntervalId)
    }
  }, [fetchOnce])

  const refreshNow = useCallback(() => {
    setListState((currentState) =>
      currentState.phase === 'ready' ? currentState : { phase: 'loading' },
    )
    void fetchOnce()
  }, [fetchOnce])

  return { listState, refreshNow }
}
