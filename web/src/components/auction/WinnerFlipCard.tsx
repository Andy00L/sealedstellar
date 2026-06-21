// The winner slot: a 3D flip card. The front is the sealed face; once the
// auction settles it flips (780ms, the unseal hero) to the open face showing
// the clearing price (the second price the winner pays, never the winning
// bid). The Verified on Soroban stamp pops in once the flip lands.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html winner flip card.

import { SealMedallion } from '@/components/auction/SealMedallion'
import { VerifiedStamp } from '@/components/auction/VerifiedStamp'
import { truncateAddress } from '@/lib/format'
import type { BidView } from '@/lib/chain'

type WinnerFlipCardProps = {
  bid: BidView
  clearingPriceText: string
  paymentSymbol: string
  flipped: boolean
  showStamp: boolean
}

// Blue-tinted glass for the open face; specific enough to keep inline.
const OPEN_FACE_STYLE = {
  background: 'linear-gradient(158deg, rgba(255,255,255,.94), rgba(247,249,255,.78))',
  border: '1px solid rgba(43,95,217,.3)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.95), 0 14px 34px rgba(43,95,217,.22)',
}

export function WinnerFlipCard({
  bid,
  clearingPriceText,
  paymentSymbol,
  flipped,
  showStamp,
}: WinnerFlipCardProps) {
  return (
    <div className="relative aspect-square [perspective:1200px]">
      <div
        className="relative h-full w-full transition-transform duration-[780ms] [transform-style:preserve-3d] [transition-timing-function:var(--ease-flip)]"
        style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* Front: sealed face. */}
        <div className="glass-panel absolute inset-0 overflow-hidden rounded-2xl p-4 [backface-visibility:hidden]">
          <div className="flex items-start justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">
              {truncateAddress(bid.bidder)}
            </span>
            <SealMedallion size={34} />
          </div>
          <div className="absolute inset-x-4 bottom-4">
            <div className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-ink-faint">
              Sealed amount
            </div>
            <div className="flex h-6 items-center rounded-md bg-foreground/5 px-2.5">
              <span className="select-none font-mono text-[13px] tracking-[2px] text-foreground/40 blur-[3px]">
                ••••••••
              </span>
            </div>
          </div>
        </div>
        {/* Back: open face with the clearing price. */}
        <div
          className="absolute inset-0 overflow-hidden rounded-2xl p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]"
          style={OPEN_FACE_STYLE}
        >
          <div className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">Clearing price</div>
          <div className="mt-1.5 font-mono text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
            {clearingPriceText}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">{paymentSymbol} · 2nd price</div>
          <div className="absolute bottom-3.5 left-4 font-mono text-[10px] text-muted-foreground">
            {truncateAddress(bid.bidder)}
          </div>
        </div>
      </div>
      {showStamp && <VerifiedStamp small pop className="absolute -top-3 -right-2.5 z-10" />}
    </div>
  )
}
