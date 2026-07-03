// The auction room: glass header, the 8-slot sealed grid, a perspective-aware
// action area, and the unseal moment. When the operator settles in-session,
// the winning card flips to the clearing price, losing cards dim to sealed
// forever, the Verified on Soroban stamp pops, and the settlement summary
// slides in. An already-settled auction opens fully revealed.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html room + unseal.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { BidSlotGrid } from '@/components/auction/BidSlotGrid'
import { OperatorStepper, type SettleResult } from '@/components/auction/OperatorStepper'
import { PerspectiveSwitch, type Perspective } from '@/components/auction/PerspectiveSwitch'
import { PlaceBidDialog } from '@/components/auction/PlaceBidDialog'
import { RefundedNotice } from '@/components/auction/RefundedNotice'
import { RoomHeader } from '@/components/auction/RoomHeader'
import { RoomSkeleton } from '@/components/auction/RoomSkeleton'
import { RpcDownNotice } from '@/components/auction/RpcDownNotice'
import { SettlementSummary } from '@/components/auction/SettlementSummary'
import { Button } from '@/components/ui/button'
import { useAuctionRoom } from '@/hooks/useAuctionRoom'
import { useNowSeconds } from '@/hooks/useNowSeconds'
import { useSettlementInfo } from '@/hooks/useSettlementInfo'
import { useWallet } from '@/hooks/useWallet'
import { countFilledSlots, deriveAuctionTone, type AuctionView } from '@/lib/chain'
import { isAuctionNotFound } from '@/lib/errors'
import { formatTokenAmount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MAX_BID_SLOTS } from '@/config'

// Unseal beats, in ms after settle confirms (winner flip, loser dim, stamp,
// summary). sourceRef: SealedStellar.dc.html playUnseal timings.
const UNSEAL_BEATS = [820, 1320, 1850]

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
      <AppShell crumb={`Auction · #${auctionId}`} title="Loading auction" backTo="/">
        <div className="mx-auto w-full max-w-[1180px] px-5 pb-14 pt-2 sm:px-8">
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
      <AppShell crumb={`Auction · #${auctionId}`} title="Auction" backTo="/">
        <div className="mx-auto w-full max-w-[1180px] px-5 pb-14 pt-2 sm:px-8">
          <RpcDownNotice retryInSeconds={roomState.retryInSeconds} onRetryNow={refreshNow} />
        </div>
      </AppShell>
    )
  }
  return <AuctionRoomBody auction={roomState.value} nowSeconds={nowSeconds} refreshNow={refreshNow} />
}

function AuctionRoomBody({
  auction,
  nowSeconds,
  refreshNow,
}: {
  auction: AuctionView
  nowSeconds: number
  refreshNow: () => void
}) {
  const { wallet, connectWallet } = useWallet()
  const tone = deriveAuctionTone(auction, nowSeconds)
  const filledSlots = countFilledSlots(auction)
  const slotsAreFull = filledSlots >= MAX_BID_SLOTS

  const [perspective, setPerspective] = useState<Perspective>(
    tone === 'awaiting' ? 'operator' : 'bidder',
  )
  const [bidDialogIsOpen, setBidDialogIsOpen] = useState(false)

  // Settlement read from the AuctionSettled event for an already-settled
  // auction; a fresh in-session settle fills localSettlement immediately.
  const settlementState = useSettlementInfo(auction.id, tone === 'settled')
  const settlementInfo = settlementState.phase === 'ready' ? settlementState.info : null
  const [localSettlement, setLocalSettlement] = useState<SettleResult | null>(null)

  // Unseal stage 0..4. An already-settled auction opens fully revealed (4).
  const [unsealStage, setUnsealStage] = useState<number>(() => (tone === 'settled' ? 4 : 0))
  const justSettledRef = useRef(false)
  const unsealTimers = useRef<number[]>([])

  const clearUnsealTimers = () => {
    unsealTimers.current.forEach((timerId) => clearTimeout(timerId))
    unsealTimers.current = []
  }
  const playUnseal = () => {
    clearUnsealTimers()
    setUnsealStage(1)
    UNSEAL_BEATS.forEach((delayMs, beatIndex) => {
      unsealTimers.current.push(
        window.setTimeout(() => setUnsealStage(beatIndex + 2), delayMs),
      )
    })
  }
  // external system: unseal animation timers; cleared on unmount.
  useEffect(() => clearUnsealTimers, [])

  // An external settle (not driven by this tab) reveals without animation.
  useEffect(() => {
    if (tone === 'settled' && !justSettledRef.current && unsealStage === 0) {
      setUnsealStage(4)
    }
  }, [tone, unsealStage])

  const handleSettled = (result: SettleResult) => {
    justSettledRef.current = true
    setLocalSettlement(result)
    setUnsealStage(0)
    playUnseal()
    refreshNow()
  }
  const replayUnseal = () => {
    clearUnsealTimers()
    setUnsealStage(0)
    unsealTimers.current.push(window.setTimeout(() => playUnseal(), 80))
  }

  const winnerIndex = useMemo(() => {
    if (localSettlement) {
      return localSettlement.winnerIndex
    }
    if (settlementInfo) {
      const matchedIndex = auction.bids.findIndex((bid) => bid.bidder === settlementInfo.winner)
      return matchedIndex >= 0 ? matchedIndex : undefined
    }
    return undefined
  }, [localSettlement, settlementInfo, auction.bids])

  const clearingPrice = localSettlement?.winningPrice ?? settlementInfo?.winningPrice ?? null
  const clearingPriceText = clearingPrice !== null ? formatTokenAmount(clearingPrice) : '—'
  const winnerAddress = localSettlement?.winnerAddress ?? settlementInfo?.winner ?? null
  const settleTxHash = localSettlement?.txHash ?? settlementInfo?.txHash
  const isSettled = tone === 'settled' || localSettlement !== null
  const showSummary = isSettled && unsealStage >= 4

  return (
    <AppShell
      crumb={`Auction · #${auction.id}`}
      title={`${formatTokenAmount(auction.lotAmount)} ${auction.lotSymbol}`}
      backTo="/"
      trailing={<PerspectiveSwitch value={perspective} onChange={setPerspective} />}
    >
      <div className="mx-auto grid w-full max-w-[1180px] gap-5.5 px-5 pb-14 pt-2 sm:px-8">
        <RoomHeader
          auction={auction}
          tone={tone}
          nowSeconds={nowSeconds}
          filledSlots={filledSlots}
          clearingPrice={clearingPrice}
        />

        <BidSlotGrid
          bids={auction.bids}
          winnerIndex={winnerIndex}
          unsealStage={unsealStage}
          clearingPriceText={clearingPriceText}
          paymentSymbol={auction.paymentSymbol}
          allDimmed={tone === 'refunded'}
        />

        {renderActionArea()}
      </div>

      <PlaceBidDialog
        auction={auction}
        open={bidDialogIsOpen}
        onClose={() => setBidDialogIsOpen(false)}
      />
    </AppShell>
  )

  function renderActionArea(): ReactNode {
    if (showSummary) {
      return (
        <SettlementSummary
          winnerAddress={winnerAddress}
          clearingPriceText={clearingPriceText}
          paymentSymbol={auction.paymentSymbol}
          lotText={`${formatTokenAmount(auction.lotAmount)} ${auction.lotSymbol}`}
          txHash={settleTxHash}
          onReplay={replayUnseal}
        />
      )
    }
    // Mid-unseal (settled but the summary has not slid in yet): the grid
    // animation is the focus, so the action area stays empty.
    if (isSettled) {
      return null
    }
    if (tone === 'refunded') {
      return <RefundedNotice auction={auction} />
    }
    if (tone === 'awaiting') {
      if (perspective === 'operator') {
        return (
          <OperatorStepper auction={auction} filledSlots={filledSlots} onSettled={handleSettled} />
        )
      }
      return (
        <Notice
          pulse
          title="Awaiting settlement"
          sub="Bidding has closed. The operator is preparing the zero-knowledge proof."
        />
      )
    }
    // tone === 'open'
    if (perspective === 'operator') {
      return (
        <Notice
          title="Bidding is still open"
          sub="Settlement opens after the deadline, once bids are sealed."
        />
      )
    }
    if (perspective === 'visitor' || wallet.status !== 'connected') {
      return (
        <CtaPanel
          title="Connect a wallet to bid"
          sub="Your bid is sealed before it ever leaves your browser."
          actionLabel={wallet.status === 'connecting' ? 'Connecting…' : 'Connect Freighter'}
          disabled={wallet.status === 'connecting'}
          onAction={() => void connectWallet()}
        />
      )
    }
    if (slotsAreFull) {
      return (
        <Notice title="All 8 slots are filled" sub="This auction has no open slots left to bid on." />
      )
    }
    return (
      <CtaPanel
        title="Place your sealed bid"
        sub="Everyone deposits the max price, so the deposit reveals nothing."
        actionLabel="Place sealed bid"
        onAction={() => setBidDialogIsOpen(true)}
      />
    )
  }
}

function CtaPanel({
  title,
  sub,
  actionLabel,
  onAction,
  disabled = false,
}: {
  title: string
  sub: string
  actionLabel: string
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-[20px] px-6 py-5">
      <div>
        <div className="text-[16px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div>
      </div>
      <Button variant="cta" disabled={disabled} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}

function Notice({
  title,
  sub,
  pulse = false,
}: {
  title: string
  sub: string
  pulse?: boolean
}) {
  return (
    <div className="glass-soft flex items-center gap-3.5 rounded-[20px] px-6 py-5">
      <span
        className={cn('size-2.25 flex-none rounded-full bg-ink-faint', pulse && 'animate-pulse')}
        aria-hidden="true"
      />
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  )
}

function AuctionMissing() {
  return (
    <AppShell crumb="Auction" title="Not found" backTo="/">
      <div className="mx-auto w-full max-w-[1180px] px-5 pb-14 pt-2 sm:px-8">
        <div className="glass-soft grid max-w-md justify-items-start gap-3 rounded-[22px] p-6">
          <span className="text-[17px] font-semibold">No auction here</span>
          <span className="text-sm text-muted-foreground">
            This auction id does not exist on this contract.
          </span>
          <Button variant="glass" size="sm" asChild>
            <Link to="/">Back to auctions</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
