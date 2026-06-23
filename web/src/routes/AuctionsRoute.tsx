// Auctions list: the home screen. A glass card grid over the ambient field,
// with a toolbar (status tabs, search, asset chips, sort, density) and a
// window-virtualized body so the list stays eye-friendly and cheap to render
// as it grows. The filter and sort pipeline lives in lib/auctions-list-view;
// this route only wires the data hook, the URL-backed view model, and the
// connected wallet together.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list screen.

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
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { useWallet } from '@/hooks/useWallet'
import { type AuctionView } from '@/lib/chain'
import {
  collectAssetSymbols,
  selectVisibleAuctions,
  type AuctionsListView,
} from '@/lib/auctions-list-view'

export function AuctionsRoute() {
  const { listState, refreshNow } = useAuctionsList()
  const nowSeconds = useNowSeconds()
  const { view, setView } = useAuctionsListView()
  const { wallet } = useWallet()
  const connectedAddress = wallet.status === 'connected' ? wallet.address : null

  return (
    <AppShell crumb="Testnet" title="Sealed auctions">
      <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 pt-2 sm:px-8">
        <div className="mb-5 flex justify-end">
          <Button asChild variant="cta" size="sm">
            <Link to="/create">Create auction</Link>
          </Button>
        </div>

        {listState.phase === 'loading' && <AuctionsSkeleton />}

        {listState.phase === 'error' && (
          <RpcDownNotice retryInSeconds={listState.retryInSeconds} onRetryNow={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length === 0 && (
          <AuctionsEmptyState onRefresh={refreshNow} />
        )}

        {listState.phase === 'ready' && listState.value.length > 0 && (
          <AuctionsReady
            auctions={listState.value}
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

type AuctionsReadyProps = {
  auctions: AuctionView[]
  view: AuctionsListView
  setView: (next: Partial<AuctionsListView>) => void
  nowSeconds: number
  connectedAddress: string | null
}

function AuctionsReady({ auctions, view, setView, nowSeconds, connectedAddress }: AuctionsReadyProps) {
  const visibleAuctions = selectVisibleAuctions(auctions, view, nowSeconds, connectedAddress)
  const assetSymbols = collectAssetSymbols(auctions)

  return (
    <>
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
        <AuctionsListBody auctions={visibleAuctions} density={view.density} nowSeconds={nowSeconds} />
      )}
    </>
  )
}
