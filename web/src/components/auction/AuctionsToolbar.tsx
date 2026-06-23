// The glass control strip above the auctions grid: status tabs, a search box,
// asset chips, a sort control, a density toggle, and the result count. It holds
// no list logic; it only maps the view model to setView calls.

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  GlassSegmentedControl,
  type SegmentedOption,
} from '@/components/auction/GlassSegmentedControl'
import { AuctionFilterChips } from '@/components/auction/AuctionFilterChips'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  SEARCH_DEBOUNCE_MS,
  type AuctionDensity,
  type AuctionSegment,
  type AuctionSort,
  type AuctionsListView,
} from '@/lib/auctions-list-view'

const SEGMENT_OPTIONS: readonly SegmentedOption<AuctionSegment>[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'closing', label: 'Closing soon' },
  { value: 'awaiting', label: 'Awaiting' },
  { value: 'settled', label: 'Settled' },
  { value: 'yours', label: 'Yours' },
]

const SORT_OPTIONS: readonly SegmentedOption<AuctionSort>[] = [
  { value: 'closing', label: 'Closing soonest' },
  { value: 'newest', label: 'Newest' },
  { value: 'bids', label: 'Most bids' },
]

const DENSITY_OPTIONS: readonly SegmentedOption<AuctionDensity>[] = [
  { value: 'comfortable', label: 'Cards' },
  { value: 'compact', label: 'Compact' },
]

type AuctionsToolbarProps = {
  view: AuctionsListView
  setView: (next: Partial<AuctionsListView>) => void
  assetSymbols: string[]
  resultCount: number
  walletConnected: boolean
}

export function AuctionsToolbar({
  view,
  setView,
  assetSymbols,
  resultCount,
  walletConnected,
}: AuctionsToolbarProps) {
  const [searchInput, setSearchInput] = useState(view.search)
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS)
  const lastPushedSearchRef = useRef(view.search)

  // external system: the URL/router. Push the settled search term into the view
  // only when it actually changes, so the back button is never fought.
  useEffect(() => {
    if (debouncedSearch !== lastPushedSearchRef.current) {
      lastPushedSearchRef.current = debouncedSearch
      setView({ search: debouncedSearch })
    }
  }, [debouncedSearch, setView])

  const segmentOptions: SegmentedOption<AuctionSegment>[] = SEGMENT_OPTIONS.map((option) =>
    option.value === 'yours' && !walletConnected
      ? { ...option, disabled: true, title: 'Connect your wallet to see auctions you have bid in' }
      : option,
  )

  return (
    <div className="mb-6 grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <GlassSegmentedControl
          ariaLabel="Filter auctions by status"
          options={segmentOptions}
          value={view.segment}
          onChange={(segment) => setView({ segment })}
        />
        <span className="shrink-0 text-[12.5px] text-muted-foreground">
          {resultCount} {resultCount === 1 ? 'auction' : 'auctions'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by id or asset"
            aria-label="Search auctions"
            className="h-9 rounded-[11px] border-white/70 bg-white/55 pl-9 backdrop-blur-md"
          />
        </div>
        <GlassSegmentedControl
          ariaLabel="Sort auctions"
          options={SORT_OPTIONS}
          value={view.sort}
          onChange={(sort) => setView({ sort })}
        />
        <GlassSegmentedControl
          ariaLabel="List density"
          options={DENSITY_OPTIONS}
          value={view.density}
          onChange={(density) => setView({ density })}
        />
      </div>

      <AuctionFilterChips
        assetSymbols={assetSymbols}
        activeAsset={view.assetSymbol}
        onSelect={(assetSymbol) => setView({ assetSymbol })}
      />
    </div>
  )
}
