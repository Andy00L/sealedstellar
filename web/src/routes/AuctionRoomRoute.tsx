// The auction room: header, live countdown, 8-slot sealed grid, slot count,
// and the bid CTA. Compositions per the hi-fi checkpoints: full width
// (4-column grid, inline CTA) above 640px; below that the 2x4 compact grid
// with the CTA pinned to the bottom edge so the bidder never scrolls to act.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx RoomScreen and
// RoomThirdScreen.

import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { BidSlotGrid } from '@/components/auction/BidSlotGrid'
import { PlaceBidDialog } from '@/components/auction/PlaceBidDialog'
import { RefundedNotice } from '@/components/auction/RefundedNotice'
import { RoomHeader } from '@/components/auction/RoomHeader'
import { RoomSkeleton } from '@/components/auction/RoomSkeleton'
import { RpcDownNotice } from '@/components/auction/RpcDownNotice'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuctionRoom } from '@/hooks/useAuctionRoom'
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { useWallet } from '@/hooks/useWallet'
import { deriveAuctionTone, countFilledSlots, type AuctionView } from '@/lib/chain'
import { isAuctionNotFound } from '@/lib/errors'
import { MAX_BID_SLOTS } from '@/config'

export function AuctionRoomRoute() {
  const { auctionId } = useParams()
  const parsedAuctionId = Number(auctionId)
  const auctionIdIsValid = Number.isInteger(parsedAuctionId) && parsedAuctionId > 0

  if (!auctionIdIsValid) {
    return <AuctionMissing />
  }
  return <AuctionRoomLoader auctionId={parsedAuctionId} />
}

function AuctionRoomLoader({ auctionId }: { auctionId: number }) {
  const { roomState, refreshNow } = useAuctionRoom(auctionId)
  const nowSeconds = useNowSeconds()

  if (roomState.phase === 'loading') {
    return (
      <AppShell>
        <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6 sm:px-7">
          <RoomSkeleton />
        </div>
      </AppShell>
    )
  }
  if (roomState.phase === 'error') {
    if (isAuctionNotFound(roomState.error)) {
      return <AuctionMissing />
    }
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-6 sm:px-7">
          <RpcDownNotice retryInSeconds={roomState.retryInSeconds} onRetryNow={refreshNow} />
        </div>
      </AppShell>
    )
  }
  return <AuctionRoomBody auction={roomState.value} nowSeconds={nowSeconds} />
}

function AuctionRoomBody({ auction, nowSeconds }: { auction: AuctionView; nowSeconds: number }) {
  const tone = deriveAuctionTone(auction, nowSeconds)
  const filledSlots = countFilledSlots(auction)
  const slotsAreFull = filledSlots >= MAX_BID_SLOTS
  const biddingIsOpen = tone === 'open' && !slotsAreFull
  const [bidDialogIsOpen, setBidDialogIsOpen] = useState(false)

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        <div className="grid flex-1 content-start gap-4 px-5 py-5 sm:gap-5.5 sm:px-7 sm:py-6.5">
          <RoomHeader auction={auction} tone={tone} nowSeconds={nowSeconds} />

          {tone === 'refunded' && <RefundedNotice auction={auction} />}

          <BidSlotGrid bids={auction.bids} allDimmed={tone === 'settled' || tone === 'refunded'} />

          {/* Inline footer row above 640px (hi-fi full-width room) */}
          <div className="hidden items-center justify-between sm:flex">
            <span className="font-mono text-[13.5px] text-muted-foreground tabular-nums">
              {filledSlots} of {MAX_BID_SLOTS} slots filled
            </span>
            <BidCallToAction
              biddingIsOpen={biddingIsOpen}
              slotsAreFull={slotsAreFull}
              onOpenDialog={() => setBidDialogIsOpen(true)}
            />
          </div>
        </div>

        {/* Pinned action bar below 640px: the bidder never scrolls to act
            (hi-fi RoomThirdScreen). */}
        <div className="sticky bottom-0 border-t border-border-soft bg-card px-5 py-3.5 sm:hidden">
          <BidCallToAction
            biddingIsOpen={biddingIsOpen}
            slotsAreFull={slotsAreFull}
            onOpenDialog={() => setBidDialogIsOpen(true)}
            fullWidth
          />
        </div>
      </div>
      <PlaceBidDialog
        auction={auction}
        open={bidDialogIsOpen}
        onClose={() => setBidDialogIsOpen(false)}
      />
    </AppShell>
  )
}

function BidCallToAction({
  biddingIsOpen,
  slotsAreFull,
  onOpenDialog,
  fullWidth = false,
}: {
  biddingIsOpen: boolean
  slotsAreFull: boolean
  onOpenDialog: () => void
  fullWidth?: boolean
}) {
  const { wallet, connectWallet } = useWallet()

  if (!biddingIsOpen) {
    const inactiveTitle = slotsAreFull
      ? 'All 8 slots are filled'
      : 'Bidding has closed for this auction'
    return (
      <Button className={fullWidth ? 'w-full' : undefined} disabled title={inactiveTitle}>
        Place sealed bid
      </Button>
    )
  }
  if (wallet.status !== 'connected') {
    return (
      <Button
        className={fullWidth ? 'w-full' : undefined}
        disabled={wallet.status === 'connecting'}
        onClick={() => void connectWallet()}
      >
        {wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet to bid'}
      </Button>
    )
  }
  return (
    <Button className={fullWidth ? 'w-full' : undefined} onClick={onOpenDialog}>
      Place sealed bid
    </Button>
  )
}

function AuctionMissing() {
  return (
    <AppShell>
      <div className="mx-auto grid max-w-xl gap-3.5 px-5 py-6 sm:px-7">
        <Card className="grid justify-items-start gap-3 rounded-xl border-border-soft p-6 shadow-card">
          <span className="text-[17px] font-semibold">No auction here</span>
          <span className="text-sm text-muted-foreground">
            This auction id does not exist on this contract.
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Back to auctions</Link>
          </Button>
        </Card>
      </div>
    </AppShell>
  )
}
