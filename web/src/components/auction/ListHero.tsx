// List hero: the one-sentence strapline plus a quiet stat strip derived from
// the polled list. Settled and proofs-verified track the same on-chain
// counter today (every settlement is exactly one verified proof); both stay
// per the density-pass instruction.

import { deriveAuctionTone, type AuctionView } from '@/lib/chain'

type ListHeroProps = {
  auctions: AuctionView[]
  nowSeconds: number
}

type StatEntry = {
  label: string
  value: number
}

export function ListHero({ auctions, nowSeconds }: ListHeroProps) {
  const liveCount = auctions.filter(
    (auction) => deriveAuctionTone(auction, nowSeconds) === 'open',
  ).length
  const settledCount = auctions.filter((auction) => auction.status === 'Settled').length
  const statEntries: StatEntry[] = [
    { label: 'live auctions', value: liveCount },
    { label: 'settled', value: settledCount },
    { label: 'proofs verified on-chain', value: settledCount },
  ]

  return (
    <div className="grid gap-3 pb-2">
      <p className="max-w-[640px] text-[17px] leading-[1.45] text-foreground sm:text-[19px]">
        <span className="font-semibold">Sealed-bid Vickrey auctions on Stellar.</span>{' '}
        <span className="text-muted-foreground">
          No bid is ever revealed, not even the winner&apos;s.
        </span>
      </p>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[12.5px] text-muted-foreground">
        {statEntries.map((statEntry, statIndex) => (
          <span key={statEntry.label} className="inline-flex items-baseline gap-1.5">
            {statIndex > 0 && <span className="text-ink-faint">·</span>}
            <span className="font-mono font-semibold text-foreground tabular-nums">
              {statEntry.value}
            </span>
            {statEntry.label}
          </span>
        ))}
      </div>
    </div>
  )
}
