// Refunded lifecycle explanation shown in the room once the grace-period path
// has run. The lot-return retry hint appears only when the on-chain flag says
// the lot is still parked (audit fix, reclaim_lot path).
// sourceRef: design-handoff/hackathon-ui-with-glass-effects glass surfaces.

import type { AuctionView } from '@/lib/chain'

type RefundedNoticeProps = {
  auction: AuctionView
}

export function RefundedNotice({ auction }: RefundedNoticeProps) {
  return (
    <div className="glass-soft flex items-center gap-3.5 rounded-[20px] px-6 py-5">
      <span className="size-2.25 flex-none rounded-full bg-destructive" aria-hidden="true" />
      <div>
        <div className="text-[15px] font-semibold">Refunded, deposits returned</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          Settlement did not arrive in time, so every deposit went back automatically. Nothing was
          revealed.
          {!auction.lotReclaimed && ' The lot stays reclaimable on chain through reclaim_lot.'}
        </div>
      </div>
    </div>
  )
}
