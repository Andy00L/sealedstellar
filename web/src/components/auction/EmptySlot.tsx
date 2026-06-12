// Unfilled bid slot: dashed frame, slot number, quiet caption.
// sourceRef: design-handoff/stellar/project/ss-theme.css .ss-emptyslot and
// ss-ui.jsx SSEmptySlot.

import { cn } from '@/lib/utils'

type EmptySlotProps = {
  slotNumber: number
  compact?: boolean
  className?: string
}

export function EmptySlot({ slotNumber, compact = false, className }: EmptySlotProps) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-lg border-[1.5px] border-dashed border-foreground/13 text-ink-faint',
        className,
      )}
    >
      <div className="grid justify-items-center gap-1.5 text-center">
        <span className="grid size-7.5 place-items-center rounded-full border-[1.5px] border-dashed border-foreground/14 text-[12.5px]">
          {slotNumber}
        </span>
        <span className={compact ? 'text-[11px]' : 'text-xs'}>empty slot</span>
      </div>
    </div>
  )
}
