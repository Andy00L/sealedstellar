import { listAuctions, type AuctionView } from '@/lib/chain'
import {
  usePolledChainResource,
  type PolledResourceState,
} from '@/hooks/usePolledChainResource'

export type AuctionsListState = PolledResourceState<AuctionView[]>

// Thin wrapper over the shared polling primitive for the list screen.
export function useAuctionsList(): { listState: AuctionsListState; refreshNow: () => void } {
  const { resourceState, refreshNow } = usePolledChainResource(listAuctions)
  return { listState: resourceState, refreshNow }
}
