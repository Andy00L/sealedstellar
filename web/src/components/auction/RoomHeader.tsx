// Room header: a glass panel carrying the lot title and status chip, a field
// row (payment, max price, seller, sealed count), and the tone metric on the
// right (live countdown, closed, or the cleared second price).
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html room header.

import { StatusPill } from '@/components/auction/StatusPill'
import { formatTokenAmount, getAuctionMetric, truncateAddress } from '@/lib/format'
import { MAX_BID_SLOTS } from '@/config'
import type { AuctionTone, AuctionView } from '@/lib/chain'

type RoomHeaderProps = {
  auction: AuctionView
  tone: AuctionTone
  nowSeconds: number
  filledSlots: number
  /** Second-price clearing value once settled; null until the event is read. */
  clearingPrice: bigint | null
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1.25 text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</div>
      <div className="font-mono text-[14px]">{value}</div>
    </div>
  )
}

export function RoomHeader({ auction, tone, nowSeconds, filledSlots, clearingPrice }: RoomHeaderProps) {
  const metric = getAuctionMetric(tone, auction.commitDeadlineSeconds - nowSeconds, clearingPrice)

  return (
    <div className="glass-panel rounded-[22px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[30px]">
              {formatTokenAmount(auction.lotAmount)}{' '}
              <span className="font-medium text-muted-foreground">{auction.lotSymbol}</span>
            </span>
            <StatusPill status={tone} />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6.5 gap-y-3">
            <HeaderField label="Payment" value={auction.paymentSymbol} />
            <HeaderField label="Max price" value={formatTokenAmount(auction.maxPrice)} />
            <HeaderField label="Seller" value={truncateAddress(auction.seller)} />
            <HeaderField label="Sealed" value={`${filledSlots} / ${MAX_BID_SLOTS}`} />
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            {metric.label}
          </div>
          <div className="font-mono text-[32px] font-medium tabular-nums">{metric.value}</div>
        </div>
      </div>
    </div>
  )
}
