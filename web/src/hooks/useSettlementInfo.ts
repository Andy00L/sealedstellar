import { useEffect, useState } from 'react'

import { getSettlementInfo, type SettlementInfo } from '@/lib/chain'

export type SettlementInfoState =
  | { phase: 'loading' }
  | { phase: 'ready'; info: SettlementInfo | null }

// One-shot fetch of the immutable settlement record (clearing price, winner,
// settle tx) for a settled auction. Null means the event left the retention
// window; the caller falls back to the plain settled treatment.
export function useSettlementInfo(auctionId: number, isSettled: boolean): SettlementInfoState {
  const [infoState, setInfoState] = useState<SettlementInfoState>({ phase: 'loading' })

  // external system: a single chain RPC event lookup per settled auction;
  // state lands in the promise callback, and the cancelled flag is the
  // cleanup for unmounts mid-flight.
  useEffect(() => {
    if (!isSettled) {
      return undefined
    }
    let isCancelled = false
    void getSettlementInfo(auctionId).then((fetched) => {
      if (isCancelled) {
        return
      }
      setInfoState({ phase: 'ready', info: fetched.ok ? fetched.value : null })
    })
    return () => {
      isCancelled = true
    }
  }, [auctionId, isSettled])

  return infoState
}
