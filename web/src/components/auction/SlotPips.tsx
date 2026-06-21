// Eight slot pips for the list card: filled pips are solid bars, empty ones
// stay dashed. A compact echo of the room's sealed-slot grid.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list card pips.

import { MAX_BID_SLOTS } from '@/config'

type SlotPipsProps = {
  filled: number
}

export function SlotPips({ filled }: SlotPipsProps) {
  return (
    <div className="flex justify-end gap-[3px]" aria-label={`${filled} of ${MAX_BID_SLOTS} slots filled`}>
      {Array.from({ length: MAX_BID_SLOTS }).map((_unusedSlot, pipIndex) => (
        <span
          key={pipIndex}
          className={
            pipIndex < filled
              ? 'h-[15px] w-[11px] rounded-[3px] bg-foreground/34'
              : 'h-[15px] w-[11px] rounded-[3px] border border-dashed border-foreground/20'
          }
        />
      ))}
    </div>
  )
}
