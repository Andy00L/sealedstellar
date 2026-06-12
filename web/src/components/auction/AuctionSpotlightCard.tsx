// "Live now" spotlight: lot, open pill, slot ticks, uniform-deposit caption,
// live countdown, enter button.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx AuctionSpotlightCard.

import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SlotTicks } from '@/components/auction/SlotTicks'
import { StatusPill } from '@/components/auction/StatusPill'
import { countFilledSlots, type AuctionView } from '@/lib/chain'
import { formatClock, formatTokenAmount } from '@/lib/format'

type AuctionSpotlightCardProps = {
  auction: AuctionView
  nowSeconds: number
}

export function AuctionSpotlightCard({ auction, nowSeconds }: AuctionSpotlightCardProps) {
  const navigate = useNavigate()
  const remainingSeconds = auction.commitDeadlineSeconds - nowSeconds

  return (
    <Card className="grid gap-4 rounded-xl border-border-soft p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xl font-semibold tracking-[-0.015em]">
          {formatTokenAmount(auction.lotAmount)} {auction.lotSymbol}
        </span>
        <StatusPill status="open" />
      </div>
      <SlotTicks filled={countFilledSlots(auction)} />
      <div className="flex items-end justify-between gap-3">
        <span className="max-w-[230px] text-[13.5px] text-muted-foreground">
          Every bidder locks the same {formatTokenAmount(auction.maxPrice)} {auction.paymentSymbol}{' '}
          deposit
        </span>
        <span className="text-right">
          <span className="font-mono block text-3xl font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums">
            {formatClock(remainingSeconds)}
          </span>
          <span className="text-xs text-muted-foreground">until close</span>
        </span>
      </div>
      <Button className="w-full" onClick={() => void navigate(`/auction/${auction.id}`)}>
        Enter auction room
      </Button>
    </Card>
  )
}
