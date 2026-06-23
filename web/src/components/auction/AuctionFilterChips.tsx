// Asset-symbol filter chips, built from the symbols present in the loaded
// auctions (never hardcoded). Selecting the active chip again clears it.

import { cn } from '@/lib/utils'

type AuctionFilterChipsProps = {
  assetSymbols: string[]
  activeAsset: string | null
  onSelect: (assetSymbol: string | null) => void
}

export function AuctionFilterChips({ assetSymbols, activeAsset, onSelect }: AuctionFilterChipsProps) {
  if (assetSymbols.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by asset">
      {assetSymbols.map((assetSymbol) => {
        const isActive = assetSymbol === activeAsset
        return (
          <button
            key={assetSymbol}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(isActive ? null : assetSymbol)}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
              isActive
                ? 'border-primary/30 bg-primary-soft text-primary-deep'
                : 'border-white/70 bg-white/55 text-muted-foreground backdrop-blur-md hover:text-foreground',
            )}
          >
            {assetSymbol}
          </button>
        )
      })}
    </div>
  )
}
