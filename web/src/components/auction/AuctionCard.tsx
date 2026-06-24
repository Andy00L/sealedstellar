// One auction in the list: a glass card carrying the lot, a status chip, the
// pay/max line, a tone-specific metric (closes-in / cleared-at), and the
// sealed-slot pips. Settled cards read the real clearing price from the
// AuctionSettled event; if it has left the retention window the metric falls
// back to the plain "Settled" label.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list card.

import { Link } from 'react-router'

import { SlotPips } from '@/components/auction/SlotPips'
import { StatusPill } from '@/components/auction/StatusPill'
import { useSettlementInfo } from '@/hooks/useSettlementInfo'
import { countFilledSlots, deriveAuctionTone, type AuctionView } from '@/lib/chain'
import { formatTokenAmount, getAuctionMetric } from '@/lib/format'
import { MAX_BID_SLOTS } from '@/config'

type AuctionCardProps = {
  auction: AuctionView
  nowSeconds: number
  // When the data source already knows the clearing price (the indexer path),
  // pass it so the card does not fetch it again; undefined means "fetch it"
  // (the RPC path). A settled auction with no event price passes null.
  providedClearingPrice?: bigint | null
}

export function AuctionCard({ auction, nowSeconds, providedClearingPrice }: AuctionCardProps) {
  const tone = deriveAuctionTone(auction, nowSeconds)
  const shouldFetchSettlement = tone === 'settled' && providedClearingPrice === undefined
  const settlementState = useSettlementInfo(auction.id, shouldFetchSettlement)
  const fetchedPrice =
    settlementState.phase === 'ready' && settlementState.info ? settlementState.info.winningPrice : null
  const clearingPrice = providedClearingPrice !== undefined ? providedClearingPrice : fetchedPrice
  const filledSlots = countFilledSlots(auction)
  const metric = getAuctionMetric(tone, auction.commitDeadlineSeconds - nowSeconds, clearingPrice)

  return (
    <Link
      to={`/auction/${auction.id}`}
      aria-label={`Open auction ${auction.id}`}
      className="glass-panel group grid gap-5 rounded-[20px] p-5.5 transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[23px] font-semibold tracking-[-0.02em]">
            {formatTokenAmount(auction.lotAmount)}{' '}
            <span className="font-medium text-muted-foreground">{auction.lotSymbol}</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-muted-foreground">
            Pay {auction.paymentSymbol} · max{' '}
            <span className="font-mono text-foreground">{formatTokenAmount(auction.maxPrice)}</span>
          </div>
        </div>
        <StatusPill status={tone} />
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-foreground/7 pt-4">
        <div className="min-w-0">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            {metric.label}
          </div>
          <div className="font-mono text-[18px] font-medium tabular-nums">{metric.value}</div>
        </div>
        <div className="text-right">
          <div className="mb-1.75 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            {filledSlots} / {MAX_BID_SLOTS}
          </div>
          <SlotPips filled={filledSlots} />
        </div>
      </div>
    </Link>
  )
}
