// Eight slot ticks: filled ticks carry the lock glyph in accent, empty ones
// stay dashed. sourceRef: design-handoff/stellar/project/ss-theme.css
// .ss-tick and ss-ui.jsx SSTicks.

import { SealLockIcon } from '@/components/auction/SealLockIcon'
import { MAX_BID_SLOTS } from '@/config'

type SlotTicksProps = {
  filled: number
}

export function SlotTicks({ filled }: SlotTicksProps) {
  return (
    <div className="flex gap-1.5" aria-label={`${filled} of ${MAX_BID_SLOTS} slots filled`}>
      {Array.from({ length: MAX_BID_SLOTS }).map((_unusedSlot, tickIndex) => (
        <span
          key={tickIndex}
          className={
            tickIndex < filled
              ? 'grid h-6.5 w-5 place-items-center rounded-[6px] border-[1.2px] border-[color-mix(in_oklab,var(--primary)_38%,#FFFFFF)] bg-primary-soft text-primary transition-colors'
              : 'grid h-6.5 w-5 place-items-center rounded-[6px] border-[1.2px] border-dashed border-foreground/14 transition-colors'
          }
        >
          {tickIndex < filled && <SealLockIcon size={10} />}
        </span>
      ))}
    </div>
  )
}
