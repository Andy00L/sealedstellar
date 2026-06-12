// Room header: lot title, seller and payment line, the privacy line, with
// the countdown and lifecycle pill on the right. Past the deadline the
// clock freezes at zero with the awaiting caption.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx RoomHeader and
// ss-unseal.jsx UnsealStage header.

import { CountdownClock } from '@/components/auction/CountdownClock'
import { StatusPill } from '@/components/auction/StatusPill'
import { formatTokenAmount, truncateAddress } from '@/lib/format'
import type { AuctionTone, AuctionView } from '@/lib/chain'

type RoomHeaderProps = {
  auction: AuctionView
  tone: AuctionTone
  nowSeconds: number
}

export function RoomHeader({ auction, tone, nowSeconds }: RoomHeaderProps) {
  const remainingSeconds = Math.max(0, auction.commitDeadlineSeconds - nowSeconds)

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <span className="text-[19px] font-semibold tracking-[-0.015em] sm:text-[26px]">
          {formatTokenAmount(auction.lotAmount)} {auction.lotSymbol}
        </span>
        <span className="text-[12.5px] text-muted-foreground sm:text-[13.5px]">
          Seller {truncateAddress(auction.seller)} · pays in {auction.paymentSymbol}
        </span>
        <span className="hidden text-[13.5px] text-muted-foreground sm:block">
          Every bidder locks the same deposit, so amounts leak nothing
        </span>
      </div>
      <div className="grid justify-items-end gap-2">
        <CountdownClock
          remainingSeconds={remainingSeconds}
          label={tone === 'open' ? 'until close' : 'awaiting settlement'}
          sizeClass="text-2xl sm:text-[32px]"
        />
        <StatusPill status={tone} />
      </div>
    </div>
  )
}
