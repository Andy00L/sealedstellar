// Shown when the chain has auctions but the active filters exclude them all.
// Distinct from AuctionsEmptyState (which means no auctions exist on chain) so
// the two situations never read the same.

import { Button } from '@/components/ui/button'

type AuctionsNoMatchesProps = {
  onClear: () => void
}

export function AuctionsNoMatches({ onClear }: AuctionsNoMatchesProps) {
  return (
    <div className="glass-soft mx-auto grid max-w-md justify-items-center gap-3.5 rounded-[22px] px-8 py-14 text-center">
      <span className="text-[17px] font-semibold">No matches for these filters</span>
      <span className="max-w-[280px] text-sm leading-[1.55] text-muted-foreground">
        No auctions match the current status, search, or asset filters. Try widening them.
      </span>
      <Button variant="glass" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}
