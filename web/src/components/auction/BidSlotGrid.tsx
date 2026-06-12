// The 8-slot grid. Bids landing on a poll tick play the land animation:
// the previously seen count is kept in state and adjusted during render
// (the React-sanctioned derived-state pattern), so slots at or beyond the
// old count animate exactly once when they first appear.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx SealedBidGrid.

import { useState } from 'react'

import { EmptySlot } from '@/components/auction/EmptySlot'
import { SealedBidCard } from '@/components/auction/SealedBidCard'
import { MAX_BID_SLOTS } from '@/config'
import type { BidView } from '@/lib/chain'

type BidSlotGridProps = {
  bids: BidView[]
  /** Dim every filled card to "sealed forever" (post-settlement losers). */
  allDimmed?: boolean
  compact?: boolean
}

type LandWindow = {
  landFromIndex: number
  seenCount: number
}

export function BidSlotGrid({ bids, allDimmed = false, compact = false }: BidSlotGridProps) {
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

  const cardHeightClass = compact ? 'h-32' : 'h-[170px] lg:h-44'
  const sealSize = compact ? 38 : 48

  return (
    <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3.5 sm:grid-cols-4'}>
      {Array.from({ length: MAX_BID_SLOTS }).map((_unusedSlot, slotIndex) => {
        const slotBid = bids[slotIndex]
        if (slotBid === undefined) {
          return (
            <EmptySlot
              key={`empty-${slotIndex}`}
              slotNumber={slotIndex + 1}
              compact={compact}
              className={cardHeightClass}
            />
          )
        }
        return (
          <SealedBidCard
            key={`bid-${slotIndex}`}
            bid={slotBid}
            sealSize={sealSize}
            dimmed={allDimmed}
            landing={slotIndex >= landWindow.landFromIndex}
            className={cardHeightClass}
          />
        )
      })}
    </div>
  )
}
