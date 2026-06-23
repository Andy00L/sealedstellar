// Compact density variant of an auction in the list: a single glass-soft row
// carrying the same data and link target as AuctionCard, but lighter (fewer
// nodes, lighter blur) so a long list stays scannable. Switching density
// changes shape, never meaning.

import { Link } from 'react-router'

import { StatusPill } from '@/components/auction/StatusPill'
import { useSettlementInfo } from '@/hooks/useSettlementInfo'
import { countFilledSlots, deriveAuctionTone, type AuctionView } from '@/lib/chain'
import { formatTokenAmount, getAuctionMetric } from '@/lib/format'
import { MAX_BID_SLOTS } from '@/config'

type AuctionRowProps = {
  auction: AuctionView
  nowSeconds: number
}

export function AuctionRow({ auction, nowSeconds }: AuctionRowProps) {
  const tone = deriveAuctionTone(auction, nowSeconds)
  const settlementState = useSettlementInfo(auction.id, tone === 'settled')
  const settlementInfo = settlementState.phase === 'ready' ? settlementState.info : null
  const filledSlots = countFilledSlots(auction)
  const metric = getAuctionMetric(
    tone,
    auction.commitDeadlineSeconds - nowSeconds,
    settlementInfo ? settlementInfo.winningPrice : null,
  )

  return (
    <Link
      to={`/auction/${auction.id}`}
      aria-label={`Open auction ${auction.id}`}
      className="glass-soft flex items-center gap-4 rounded-[14px] px-4 py-3 transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">
          {formatTokenAmount(auction.lotAmount)}{' '}
          <span className="font-medium text-muted-foreground">{auction.lotSymbol}</span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
          Pay {auction.paymentSymbol} · max{' '}
          <span className="font-mono text-foreground">{formatTokenAmount(auction.maxPrice)}</span>
        </div>
      </div>
      <div className="hidden min-w-[120px] text-right sm:block">
        <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">{metric.label}</div>
        <div className="font-mono text-[14px] font-medium tabular-nums">{metric.value}</div>
      </div>
      <div className="hidden w-[52px] text-right font-mono text-[12px] tabular-nums text-muted-foreground sm:block">
        {filledSlots} / {MAX_BID_SLOTS}
      </div>
      <StatusPill status={tone} className="shrink-0" />
    </Link>
  )
}
