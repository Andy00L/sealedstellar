// Tabular countdown with its caption.
// sourceRef: design-handoff/stellar/project/ss-ui.jsx SSCountdown.

import { formatClock } from '@/lib/format'
import { cn } from '@/lib/utils'

type CountdownClockProps = {
  remainingSeconds: number
  label?: string
  sizeClass?: string
}

export function CountdownClock({
  remainingSeconds,
  label = 'until close',
  sizeClass = 'text-[32px]',
}: CountdownClockProps) {
  return (
    <span className="text-right">
      <span
        className={cn(
          'font-mono block font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums',
          sizeClass,
        )}
      >
        {formatClock(remainingSeconds)}
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  )
}
