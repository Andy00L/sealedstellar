// Auctions list: the home screen. One uniform grid of glass cards over the
// ambient field, ordered live-first so an open auction is always on top.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list screen.

import { AppShell } from '@/components/layout/AppShell'
import { AuctionCard } from '@/components/auction/AuctionCard'
import { AuctionsEmptyState } from '@/components/auction/AuctionsEmptyState'
import { AuctionsSkeleton } from '@/components/auction/AuctionsSkeleton'
import { RpcDownNotice } from '@/components/auction/RpcDownNotice'
import { useAuctionsList } from '@/hooks/useAuctionsList'
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { deriveAuctionTone, type AuctionTone, type AuctionView } from '@/lib/chain'

// Live auctions first, then awaiting, settled, refunded; newest id first
// within each tone so the latest staged auction surfaces at the top.
const TONE_ORDER: Record<AuctionTone, number> = { open: 0, awaiting: 1, settled: 2, refunded: 3 }

function orderForDisplay(auctions: AuctionView[], nowSeconds: number): AuctionView[] {
  return [...auctions].sort((firstAuction, secondAuction) => {
    const toneDelta =
      TONE_ORDER[deriveAuctionTone(firstAuction, nowSeconds)] -
      TONE_ORDER[deriveAuctionTone(secondAuction, nowSeconds)]
    return toneDelta !== 0 ? toneDelta : secondAuction.id - firstAuction.id
  })
}

export function AuctionsRoute() {
  const { listState, refreshNow } = useAuctionsList()
  const nowSeconds = useNowSeconds()

  return (
    <AppShell crumb="Testnet" title="Sealed auctions">
      <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 pt-2 sm:px-8">
        {listState.phase === 'loading' && <AuctionsSkeleton />}

        {listState.phase === 'error' && (
          <RpcDownNotice retryInSeconds={listState.retryInSeconds} onRetryNow={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length === 0 && (
          <AuctionsEmptyState onRefresh={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-[repeat(auto-fill,minmax(330px,1fr))]">
            {orderForDisplay(listState.value, nowSeconds).map((auction) => (
              <AuctionCard key={auction.id} auction={auction} nowSeconds={nowSeconds} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
