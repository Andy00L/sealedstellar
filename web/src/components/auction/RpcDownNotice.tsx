// RPC failure state with a live auto-retry countdown, in a soft glass panel.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects glass surfaces.

import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/format'

type RpcDownNoticeProps = {
  retryInSeconds: number
  onRetryNow: () => void
}

export function RpcDownNotice({ retryInSeconds, onRetryNow }: RpcDownNoticeProps) {
  // mm:ss reads better than hh:mm:ss at this scale.
  const compactClock = formatClock(retryInSeconds).slice(3)
  return (
    <div className="glass-soft mx-auto grid max-w-md justify-items-center gap-2.5 rounded-[22px] px-8 py-14 text-center">
      <span className="max-w-[240px] text-sm leading-[1.55] text-muted-foreground">
        Testnet RPC is not answering. The auction is unaffected; we just cannot see it right now.
      </span>
      <Button variant="glass" size="sm" onClick={onRetryNow}>
        Retry now
      </Button>
      <span className="font-mono text-[11px] text-ink-faint tabular-nums">
        Retrying automatically in {compactClock} · never an infinite spinner
      </span>
    </div>
  )
}
