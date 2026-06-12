// RPC failure state with a live auto-retry countdown.
// sourceRef: design-handoff/stellar/project/ss-unseal.jsx EdgeRpc (the
// mockup caption used a long dash; rewritten with a middle dot per the
// writing standards).

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
    <div className="grid justify-items-center gap-2.5 px-8 py-13 text-center">
      <span className="max-w-[240px] text-sm leading-[1.55] text-muted-foreground">
        Testnet RPC is not answering. The auction is unaffected; we just cannot see it right now.
      </span>
      <Button variant="outline" size="sm" onClick={onRetryNow}>
        Retry now
      </Button>
      <span className="font-mono text-[11px] text-ink-faint tabular-nums">
        Retrying automatically in {compactClock} · never an infinite spinner
      </span>
    </div>
  )
}
