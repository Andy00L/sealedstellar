// The sealed bid card: paper-grain surface, wax seal, bidder address above,
// commitment hash below. Lifecycle: sealed (default), sealedForever (dimmed
// after settlement for losing bids), landing (entry animation when a bid
// arrives on a poll tick). Custom domain component: the wax motif has no
// primitive equivalent.
// sourceRef: design-handoff/stellar/project/ss-theme.css .ss-bidcard and
// ss-ui.jsx SSBidCard.

import { WaxSeal } from '@/components/auction/WaxSeal'
import { cn } from '@/lib/utils'
import { commitmentToTruncatedHex } from '@/lib/format'
import { truncateAddress } from '@/lib/format'
import type { BidView } from '@/lib/chain'

type SealedBidCardProps = {
  bid: BidView
  sealSize?: number
  dimmed?: boolean
  landing?: boolean
  className?: string
}

export function SealedBidCard({
  bid,
  sealSize = 48,
  dimmed = false,
  landing = false,
  className,
}: SealedBidCardProps) {
  return (
    <div
      className={cn(
        'paper-grain flex flex-col items-center justify-between overflow-hidden',
        'rounded-lg border border-border-soft bg-card px-3 pt-3.25 pb-3 shadow-card',
        'transition-[opacity,filter] duration-(--motion-dim) ease-out',
        dimmed && 'opacity-[0.42] grayscale-[0.55]',
        landing && 'animate-land',
        className,
      )}
    >
      <span className="font-mono text-[11px] text-ink-faint tabular-nums">
        {truncateAddress(bid.bidder)}
      </span>
      <span className="grid place-items-center gap-2">
        <WaxSeal size={sealSize} />
        <span className="text-[10px] lowercase tracking-[0.24em] text-ink-faint">
          {dimmed ? 'sealed forever' : 'sealed'}
        </span>
      </span>
      <span className="font-mono text-xs tabular-nums">
        {commitmentToTruncatedHex(bid.commitment)}
      </span>
    </div>
  )
}
