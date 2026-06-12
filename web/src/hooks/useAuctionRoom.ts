import { useCallback } from 'react'

import { getAuction, type AuctionView } from '@/lib/chain'
import {
  usePolledChainResource,
  type PolledResourceState,
} from '@/hooks/usePolledChainResource'

export type AuctionRoomState = PolledResourceState<AuctionView>

// Thin wrapper over the shared polling primitive for a single auction room.
export function useAuctionRoom(auctionId: number): {
  roomState: AuctionRoomState
  refreshNow: () => void
} {
  const fetchThisAuction = useCallback(() => getAuction(auctionId), [auctionId])
  const { resourceState, refreshNow } = usePolledChainResource(fetchThisAuction)
  return { roomState: resourceState, refreshNow }
}
