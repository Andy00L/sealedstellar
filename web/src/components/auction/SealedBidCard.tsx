// A sealed bid slot: a frosted glass square with paper grain, the bidder
// address and truncated commitment, the seal medallion, and a redaction bar
// standing in for the hidden amount (no real value is ever shown). After
// settlement, losing slots dim to "sealed forever". Landing plays once when a
// bid first arrives on a poll tick.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html sealed slot.

import { SealMedallion } from '@/components/auction/SealMedallion'
import { cn } from '@/lib/utils'
import { commitmentToTruncatedHex, truncateAddress } from '@/lib/format'
import type { BidView } from '@/lib/chain'

type SealedBidCardProps = {
  bid: BidView
  dimmed?: boolean
  landing?: boolean
}

export function SealedBidCard({ bid, dimmed = false, landing = false }: SealedBidCardProps) {
  return (
    <div
      className={cn(
        'paper-grain glass-panel relative aspect-square overflow-hidden rounded-2xl p-4',
        'transition-[opacity,filter] duration-(--motion-dim) ease-out',
        dimmed && 'opacity-[0.38] saturate-[0.7]',
        landing && 'animate-land',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-muted-foreground">
            {truncateAddress(bid.bidder)}
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink-faint">
            commit {commitmentToTruncatedHex(bid.commitment)}
          </div>
        </div>
        <SealMedallion size={34} />
      </div>
      <div className="absolute inset-x-4 bottom-4">
        <div className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-ink-faint">
          {dimmed ? 'Sealed forever' : 'Sealed amount'}
        </div>
        {/* Redaction bar: the hidden bid amount is never rendered, only obscured. */}
        <div className="flex h-6 items-center rounded-md bg-foreground/5 px-2.5">
          <span className="select-none font-mono text-[13px] tracking-[2px] text-foreground/40 blur-[3px]">
            ••••••••
          </span>
        </div>
      </div>
    </div>
  )
}
