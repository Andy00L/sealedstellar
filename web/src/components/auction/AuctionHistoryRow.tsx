// "Earlier" list row: lot, deposit caption, slot count, lifecycle marker.
// Settled rows upgrade to the true clearing price (read from the
// AuctionSettled event) plus the small verified stamp; if the event has
// left the retention window the row falls back to the plain pill.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx AuctionHistoryRow
// and ss-ui.jsx SSStamp (sm).

import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/auction/StatusPill'
import { VerifiedStamp } from '@/components/auction/VerifiedStamp'
import { useSettlementInfo } from '@/hooks/useSettlementInfo'
import { countFilledSlots, type AuctionTone, type AuctionView } from '@/lib/chain'
import { formatTokenAmount } from '@/lib/format'
import { MAX_BID_SLOTS } from '@/config'

type AuctionHistoryRowProps = {
  auction: AuctionView
  tone: AuctionTone
}

export function AuctionHistoryRow({ auction, tone }: AuctionHistoryRowProps) {
  const settlementState = useSettlementInfo(auction.id, tone === 'settled')
  const settlementInfo =
    settlementState.phase === 'ready' ? settlementState.info : null

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
        {tone === 'settled' && settlementInfo && (
          <span className="hidden text-right sm:grid">
            <span className="font-mono text-[13.5px] font-semibold tabular-nums">
              {formatTokenAmount(settlementInfo.winningPrice)} {auction.paymentSymbol}
            </span>
            <span className="text-[11px] text-muted-foreground">cleared at second price</span>
          </span>
        )}
        <span className="font-mono w-[50px] text-[13px] text-muted-foreground tabular-nums">
          {countFilledSlots(auction)} of {MAX_BID_SLOTS}
        </span>
        {tone === 'settled' && settlementInfo ? (
          <VerifiedStamp small />
        ) : (
          <StatusPill status={tone} />
        )}
        <ChevronRight size={16} className="text-ink-faint" aria-hidden="true" />
      </Link>
    </Card>
  )
}
