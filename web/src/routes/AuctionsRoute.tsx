// Auctions list: the home screen. Open auctions get the spotlight treatment
// under "Live now"; everything else lands under "Earlier".
// sourceRef: design-handoff/stellar/project/ss-screens.jsx ListScreen.

import { AppShell } from '@/components/layout/AppShell'
import { AuctionHistoryRow } from '@/components/auction/AuctionHistoryRow'
import { AuctionSpotlightCard } from '@/components/auction/AuctionSpotlightCard'
import { ListHero } from '@/components/auction/ListHero'
import { AuctionsEmptyState } from '@/components/auction/AuctionsEmptyState'
import { AuctionsSkeleton } from '@/components/auction/AuctionsSkeleton'
import { RpcDownNotice } from '@/components/auction/RpcDownNotice'
import { useAuctionsList } from '@/hooks/useAuctionsList'
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { deriveAuctionTone, type AuctionView } from '@/lib/chain'

export function AuctionsRoute() {
  const { listState, refreshNow } = useAuctionsList()
  const nowSeconds = useNowSeconds()

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-xl gap-3.5 px-5 py-6 sm:px-7 lg:max-w-[920px]">
        {listState.phase === 'loading' && <AuctionsSkeleton />}

        {listState.phase === 'error' && (
          <RpcDownNotice retryInSeconds={listState.retryInSeconds} onRetryNow={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length === 0 && (
          <AuctionsEmptyState onRefresh={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length > 0 && (
          <ListBody nowSeconds={nowSeconds} auctions={listState.value} />
        )}
      </div>
    </AppShell>
  )
}

type ListBodyProps = {
  nowSeconds: number
  auctions: AuctionView[]
}

function ListBody({ nowSeconds, auctions }: ListBodyProps) {
  const openAuctions = auctions.filter(
    (auction) => deriveAuctionTone(auction, nowSeconds) === 'open',
  )
  const earlierAuctions = auctions
    .filter((auction) => deriveAuctionTone(auction, nowSeconds) !== 'open')
    .reverse()

  return (
    <>
      <ListHero auctions={auctions} nowSeconds={nowSeconds} />
      {openAuctions.length > 0 && (
        <>
          <span className="text-[19px] font-semibold tracking-[-0.01em]">Live now</span>
          <div className="grid gap-3.5 lg:grid-cols-2">
            {openAuctions.map((auction) => (
              <AuctionSpotlightCard key={auction.id} auction={auction} nowSeconds={nowSeconds} />
            ))}
          </div>
        </>
      )}
      {earlierAuctions.length > 0 && (
        <>
          <span className="mt-2 text-[13px] font-semibold text-muted-foreground">Earlier</span>
          {earlierAuctions.map((auction) => (
            <AuctionHistoryRow
              key={auction.id}
              auction={auction}
              tone={deriveAuctionTone(auction, nowSeconds)}
            />
          ))}
        </>
      )}
    </>
  )
}
