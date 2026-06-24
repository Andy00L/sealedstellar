// Auctions list: the home screen. It reads from the off-chain indexer (scalable
// filter / sort / cursor pagination) and falls back to direct RPC reads only
// when the indexer is unreachable, so the demo never goes dark. Both paths feed
// the same toolbar and window-virtualized body, which consume a source-agnostic
// AuctionListItem. The filter and sort pipeline lives in lib/auctions-list-view.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list screen.

import { useCallback } from 'react'
import { Link } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { AuctionsListBody } from '@/components/auction/AuctionsListBody'
import { AuctionsToolbar } from '@/components/auction/AuctionsToolbar'
import { AuctionsEmptyState } from '@/components/auction/AuctionsEmptyState'
import { AuctionsNoMatches } from '@/components/auction/AuctionsNoMatches'
import { AuctionsSkeleton } from '@/components/auction/AuctionsSkeleton'
import { RpcDownNotice } from '@/components/auction/RpcDownNotice'
import { Button } from '@/components/ui/button'
import { useAuctionsList } from '@/hooks/useAuctionsList'
import { useAuctionsListView } from '@/hooks/useAuctionsListView'
import { useAuctionsQuery } from '@/hooks/useAuctionsQuery'
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { useWallet } from '@/hooks/useWallet'
import {
  collectAssetSymbols,
  selectVisibleAuctions,
  type AuctionListItem,
  type AuctionsListView,
} from '@/lib/auctions-list-view'

type AuctionsQueryResult = ReturnType<typeof useAuctionsQuery>

type ListSectionProps = {
  view: AuctionsListView
  setView: (next: Partial<AuctionsListView>) => void
  nowSeconds: number
  connectedAddress: string | null
}

export function AuctionsRoute() {
  const nowSeconds = useNowSeconds()
  const { view, setView } = useAuctionsListView()
  const { wallet } = useWallet()
  const connectedAddress = wallet.status === 'connected' ? wallet.address : null
  const indexerQuery = useAuctionsQuery(view, connectedAddress)

  return (
    <AppShell crumb="Testnet" title="Sealed auctions">
      <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 pt-2 sm:px-8">
        <div className="mb-5 flex justify-end">
          <Button asChild variant="cta" size="sm">
            <Link to="/create">Create auction</Link>
          </Button>
        </div>

        {indexerQuery.isError ? (
          <RpcFallbackList
            view={view}
            setView={setView}
            nowSeconds={nowSeconds}
            connectedAddress={connectedAddress}
          />
        ) : (
          <IndexerList
            query={indexerQuery}
            view={view}
            setView={setView}
            nowSeconds={nowSeconds}
            connectedAddress={connectedAddress}
          />
        )}
      </div>
    </AppShell>
  )
}

function IndexerList({
  query,
  view,
  setView,
  nowSeconds,
  connectedAddress,
}: ListSectionProps & { query: AuctionsQueryResult }) {
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const onReachEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (query.isPending) {
    return <AuctionsSkeleton />
  }

  const items: AuctionListItem[] = query.data ? query.data.pages.flatMap((page) => page.items) : []
  const totalCount = query.data?.pages[0]?.totalCount ?? items.length
  const assetSymbols = collectAssetSymbols(items.map((item) => item.view))

  return (
    <>
      <AuctionsToolbar
        view={view}
        setView={setView}
        assetSymbols={assetSymbols}
        resultCount={totalCount}
        walletConnected={connectedAddress !== null}
      />
      {items.length === 0 ? (
        <AuctionsNoMatches
          onClear={() => setView({ segment: 'all', search: '', assetSymbol: null })}
        />
      ) : (
        <AuctionsListBody
          items={items}
          density={view.density}
          nowSeconds={nowSeconds}
          hasMore={hasNextPage}
          onReachEnd={onReachEnd}
        />
      )}
    </>
  )
}

function RpcFallbackList({ view, setView, nowSeconds, connectedAddress }: ListSectionProps) {
  const { listState, refreshNow } = useAuctionsList()

  if (listState.phase === 'loading') {
    return <AuctionsSkeleton />
  }
  if (listState.phase === 'error') {
    return <RpcDownNotice retryInSeconds={listState.retryInSeconds} onRetryNow={refreshNow} />
  }
  if (listState.value.length === 0) {
    return <AuctionsEmptyState onRefresh={refreshNow} />
  }

  const visibleAuctions = selectVisibleAuctions(listState.value, view, nowSeconds, connectedAddress)
  const assetSymbols = collectAssetSymbols(listState.value)
  const items: AuctionListItem[] = visibleAuctions.map((auctionView) => ({
    view: auctionView,
    clearingPrice: undefined,
  }))

  return (
    <>
      <p className="mb-4 text-[12px] text-muted-foreground">
        The directory is unavailable; showing live chain results.
      </p>
      <AuctionsToolbar
        view={view}
        setView={setView}
        assetSymbols={assetSymbols}
        resultCount={visibleAuctions.length}
        walletConnected={connectedAddress !== null}
      />
      {visibleAuctions.length === 0 ? (
        <AuctionsNoMatches
          onClear={() => setView({ segment: 'all', search: '', assetSymbol: null })}
        />
      ) : (
        <AuctionsListBody items={items} density={view.density} nowSeconds={nowSeconds} />
      )}
    </>
  )
}
