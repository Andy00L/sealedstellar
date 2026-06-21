// Room perspective switch: a glass segmented control to view the room as a
// visitor, a bidder, or the operator. The wallet connection stays real and
// independent; this only chooses which action panel is shown, so judges can
// preview every view during the demo. Settle remains permissionless on chain,
// so an operator view does not imply special authority.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html role switcher.

import { cn } from '@/lib/utils'

export type Perspective = 'visitor' | 'bidder' | 'operator'

const PERSPECTIVE_OPTIONS: { value: Perspective; label: string }[] = [
  { value: 'visitor', label: 'Visitor' },
  { value: 'bidder', label: 'Bidder' },
  { value: 'operator', label: 'Operator' },
]

type PerspectiveSwitchProps = {
  value: Perspective
  onChange: (next: Perspective) => void
}

export function PerspectiveSwitch({ value, onChange }: PerspectiveSwitchProps) {
  return (
    <div className="hidden items-center gap-0.5 rounded-[13px] border border-white/70 bg-white/55 p-1 backdrop-blur-md sm:flex">
      {PERSPECTIVE_OPTIONS.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'cursor-pointer rounded-[9px] px-3 py-1.75 text-[12.5px] font-semibold transition-colors',
              isActive
                ? 'bg-white/90 text-foreground shadow-[0_2px_8px_rgba(40,38,52,.12)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
