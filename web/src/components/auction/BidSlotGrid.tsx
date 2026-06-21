// The 8-slot grid. Empty slots are dashed; filled slots are sealed cards; the
// winning slot (once known) is the flip card. After the winner is revealed
// (unseal stage >= 2) the losing slots dim to "sealed forever". Bids landing
// on a poll tick play the land animation once: the previously seen count is
// kept in state and adjusted during render (the React-sanctioned
// derived-state pattern).
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html slot grid.

import { useState } from 'react'

import { EmptySlot } from '@/components/auction/EmptySlot'
import { SealedBidCard } from '@/components/auction/SealedBidCard'
import { WinnerFlipCard } from '@/components/auction/WinnerFlipCard'
import { MAX_BID_SLOTS } from '@/config'
import type { BidView } from '@/lib/chain'

type BidSlotGridProps = {
  bids: BidView[]
  /** Index of the winning slot once settled; renders the flip card there. */
  winnerIndex?: number
  /** Unseal progress 0..4: drives the winner flip (>=1) and loser dim (>=2). */
  unsealStage?: number
  /** Second-price value shown on the winner card's open face. */
  clearingPriceText?: string
  paymentSymbol?: string
  /** Dim every filled card (the refunded auction has no winner to reveal). */
  allDimmed?: boolean
}

type LandWindow = {
  landFromIndex: number
  seenCount: number
}

export function BidSlotGrid({
  bids,
  winnerIndex,
  unsealStage = 0,
  clearingPriceText = '—',
  paymentSymbol = '',
  allDimmed = false,
}: BidSlotGridProps) {
  const [landWindow, setLandWindow] = useState<LandWindow>({
    landFromIndex: bids.length,
    seenCount: bids.length,
  })
  if (bids.length !== landWindow.seenCount) {
    setLandWindow({
      landFromIndex: bids.length > landWindow.seenCount ? landWindow.seenCount : bids.length,
      seenCount: bids.length,
    })
  }

  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      {Array.from({ length: MAX_BID_SLOTS }).map((_unusedSlot, slotIndex) => {
        const slotBid = bids[slotIndex]
        if (slotBid === undefined) {
          return <EmptySlot key={`empty-${slotIndex}`} />
        }
        if (winnerIndex !== undefined && slotIndex === winnerIndex) {
          return (
            <WinnerFlipCard
              key={`bid-${slotIndex}`}
              bid={slotBid}
              clearingPriceText={clearingPriceText}
              paymentSymbol={paymentSymbol}
              flipped={unsealStage >= 1}
              showStamp={unsealStage >= 3}
            />
          )
        }
        const dimmed = allDimmed || (winnerIndex !== undefined && unsealStage >= 2)
        return (
          <SealedBidCard
            key={`bid-${slotIndex}`}
            bid={slotBid}
            dimmed={dimmed}
            landing={slotIndex >= landWindow.landFromIndex}
          />
        )
      })}
    </div>
  )
}
