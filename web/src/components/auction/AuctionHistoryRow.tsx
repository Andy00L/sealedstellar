// "Earlier" list row: lot, deposit caption, slot count, lifecycle pill.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx AuctionHistoryRow.

import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/auction/StatusPill'
import { countFilledSlots, type AuctionTone, type AuctionView } from '@/lib/chain'
import { formatTokenAmount } from '@/lib/format'
import { MAX_BID_SLOTS } from '@/config'

type AuctionHistoryRowProps = {
  auction: AuctionView
  tone: AuctionTone
}

export function AuctionHistoryRow({ auction, tone }: AuctionHistoryRowProps) {
  return (
    <Card className="rounded-lg border-border-soft p-0 shadow-none">
      <Link
        to={`/auction/${auction.id}`}
        className="flex items-center gap-4 px-4.5 py-3.25"
        aria-label={`Open auction ${auction.id}`}
      >
        <span className="grid flex-1 gap-px">
          <span className="text-[15px] font-semibold">
            {formatTokenAmount(auction.lotAmount)} {auction.lotSymbol}
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            {auction.paymentSymbol} · {formatTokenAmount(auction.maxPrice)} deposit
          </span>
        </span>
        <span className="font-mono w-[50px] text-[13px] text-muted-foreground tabular-nums">
          {countFilledSlots(auction)} of {MAX_BID_SLOTS}
        </span>
        <StatusPill status={tone} />
        <ChevronRight size={16} className="text-ink-faint" aria-hidden="true" />
      </Link>
    </Card>
  )
}
