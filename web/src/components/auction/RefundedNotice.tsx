// Refunded lifecycle explanation shown in the room once the grace period
// path has run. The lot-return retry hint appears only when the on-chain
// flag says the lot is still parked (audit fix, reclaim_lot path).
// sourceRef: design-handoff/stellar/project/ss-unseal.jsx EdgeRefunded
// (mockup copy carried a typographic apostrophe only; no dash rewrites
// needed here).

import { StatusPill } from '@/components/auction/StatusPill'
import type { AuctionView } from '@/lib/chain'

type RefundedNoticeProps = {
  auction: AuctionView
}

export function RefundedNotice({ auction }: RefundedNoticeProps) {
  return (
    <div className="grid justify-items-center gap-2.5 rounded-xl border border-border-soft bg-card px-6 py-7 text-center shadow-card">
      <StatusPill status="refunded" />
      <span className="max-w-[260px] text-[13px] leading-[1.5] text-muted-foreground">
        Settlement did not arrive in time, so every deposit went back automatically. Nothing was
        revealed.
      </span>
      {!auction.lotReclaimed && (
        <span className="text-[11px] text-ink-faint">
          The lot is still in escrow; it stays reclaimable on chain through reclaim_lot.
        </span>
      )}
    </div>
  )
}
