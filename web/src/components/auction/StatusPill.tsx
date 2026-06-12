// Auction lifecycle pill, composed on the shadcn Badge with the hi-fi tone
// recipe: dot plus label, one wash per status.
// sourceRef: design-handoff/stellar/project/ss-theme.css .ss-pill and
// ss-ui.jsx SSPill.

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type AuctionStatusTone = 'open' | 'awaiting' | 'settled' | 'refunded'

const STATUS_LABELS: Record<AuctionStatusTone, string> = {
  open: 'Open for bids',
  awaiting: 'Awaiting settlement',
  settled: 'Settled',
  refunded: 'Refunded',
}

const STATUS_CLASSES: Record<AuctionStatusTone, string> = {
  open: 'text-primary bg-primary-soft',
  awaiting: 'text-muted-foreground bg-foreground/5',
  settled: 'text-foreground bg-foreground/7',
  refunded: 'text-destructive bg-[color-mix(in_oklab,var(--destructive)_8%,#FFFFFF)]',
}

type StatusPillProps = {
  status: AuctionStatusTone
  className?: string
}

export function StatusPill({ status, className }: StatusPillProps) {
  return (
    <Badge
      variant="ghost"
      className={cn(
        'gap-1.5 px-2.75 py-0.75 text-[12.5px] font-medium',
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </Badge>
  )
}
