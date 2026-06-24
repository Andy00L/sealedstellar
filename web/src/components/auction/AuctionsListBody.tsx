// The list body: renders the filtered auctions through a window virtualizer so
// only the on-screen rows (plus a small overscan) ever mount. That bounds the
// number of GPU-costly glass cards regardless of how many auctions match, and
// gives lazy settlement for free: a settled card fetches its clearing price only
// once it scrolls into view (an unmounted card fetches nothing). On the indexer
// path the parent supplies hasMore + onReachEnd, so reaching the last row loads
// the next page (infinite scroll); the RPC path omits them.

import { useEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import { AuctionCard } from '@/components/auction/AuctionCard'
import { AuctionRow } from '@/components/auction/AuctionRow'
import { type AuctionDensity, type AuctionListItem } from '@/lib/auctions-list-view'

// Match the comfortable card grid: minimum card width and the gap between
// cards. Unit: pixels. Source: the card grid template (gap-5 / minmax(330px)).
const CARD_MIN_WIDTH_PX = 330
const GRID_GAP_PX = 20
// Seed row heights per density (card or row height plus the row gap). The
// virtualizer corrects each row via measureElement, so these only seed the
// first paint. Unit: pixels. Source: this module.
const CARD_ROW_ESTIMATE_PX = 176
const COMPACT_ROW_ESTIMATE_PX = 72
const ROW_OVERSCAN = 4

type AuctionsListBodyProps = {
  items: AuctionListItem[]
  density: AuctionDensity
  nowSeconds: number
  hasMore?: boolean
  onReachEnd?: () => void
}

export function AuctionsListBody({
  items,
  density,
  nowSeconds,
  hasMore = false,
  onReachEnd,
}: AuctionsListBodyProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [columnCount, setColumnCount] = useState(1)
  const [scrollMargin, setScrollMargin] = useState(0)

  // external system: the viewport. On resize (and once on mount) recompute the
  // column count from the list width and the scroll margin (the list's offset
  // from the document top, which the window virtualizer needs). Listener
  // removed on unmount.
  useEffect(() => {
    const measure = () => {
      const element = listRef.current
      if (element === null) {
        return
      }
      const width = element.clientWidth
      const columns = Math.floor((width + GRID_GAP_PX) / (CARD_MIN_WIDTH_PX + GRID_GAP_PX))
      setColumnCount(Math.max(1, columns))
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [])

  const effectiveColumns = density === 'compact' ? 1 : columnCount
  const rowCount = Math.ceil(items.length / effectiveColumns)
  const rowEstimate = density === 'compact' ? COMPACT_ROW_ESTIMATE_PX : CARD_ROW_ESTIMATE_PX

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowEstimate,
    overscan: ROW_OVERSCAN,
    scrollMargin,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualRow = virtualRows.at(-1)
  const lastVisibleIndex = lastVirtualRow ? lastVirtualRow.index : -1

  // external system: the infinite query. When the last row scrolls into view and
  // more pages exist, ask the parent to load the next page. onReachEnd is stable
  // and guards against double-fetching, so this fires once per page boundary.
  useEffect(() => {
    if (onReachEnd && hasMore && rowCount > 0 && lastVisibleIndex >= rowCount - 1) {
      onReachEnd()
    }
  }, [onReachEnd, hasMore, rowCount, lastVisibleIndex])

  return (
    <div ref={listRef} className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {virtualRows.map((virtualRow) => {
        const startIndex = virtualRow.index * effectiveColumns
        const rowItems = items.slice(startIndex, startIndex + effectiveColumns)
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            {density === 'compact' ? (
              <div className="pb-2">
                {rowItems.map((item) => (
                  <AuctionRow
                    key={item.view.id}
                    auction={item.view}
                    nowSeconds={nowSeconds}
                    providedClearingPrice={item.clearingPrice}
                  />
                ))}
              </div>
            ) : (
              <div
                className="grid gap-5 pb-5"
                style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
              >
                {rowItems.map((item) => (
                  <AuctionCard
                    key={item.view.id}
                    auction={item.view}
                    nowSeconds={nowSeconds}
                    providedClearingPrice={item.clearingPrice}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
