// The list body: renders the filtered auctions through a window virtualizer so
// only the on-screen rows (plus a small overscan) ever mount. That bounds the
// number of GPU-costly glass cards regardless of how many auctions match, and
// gives lazy settlement for free: a settled card calls useSettlementInfo only
// once it scrolls into view (an unmounted card fetches nothing).
// Why new: the route rendered every card in a static grid; the windowed
// renderer that makes large lists cheap is new.

import { useEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import { AuctionCard } from '@/components/auction/AuctionCard'
import { AuctionRow } from '@/components/auction/AuctionRow'
import { type AuctionView } from '@/lib/chain'
import { type AuctionDensity } from '@/lib/auctions-list-view'

// Match the comfortable card grid: minimum card width and the gap between
// cards. Unit: pixels. Source: the card grid template in AuctionsRoute history
// (gap-5 / minmax(330px, 1fr)).
const CARD_MIN_WIDTH_PX = 330
const GRID_GAP_PX = 20
// Seed row heights per density (card or row height plus the row gap). The
// virtualizer corrects each row via measureElement, so these only seed the
// first paint. Unit: pixels. Source: this module.
const CARD_ROW_ESTIMATE_PX = 176
const COMPACT_ROW_ESTIMATE_PX = 72
const ROW_OVERSCAN = 4

type AuctionsListBodyProps = {
  auctions: AuctionView[]
  density: AuctionDensity
  nowSeconds: number
}

export function AuctionsListBody({ auctions, density, nowSeconds }: AuctionsListBodyProps) {
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
  const rowCount = Math.ceil(auctions.length / effectiveColumns)
  const rowEstimate = density === 'compact' ? COMPACT_ROW_ESTIMATE_PX : CARD_ROW_ESTIMATE_PX

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowEstimate,
    overscan: ROW_OVERSCAN,
    scrollMargin,
  })

  return (
    <div ref={listRef} className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const startIndex = virtualRow.index * effectiveColumns
        const rowAuctions = auctions.slice(startIndex, startIndex + effectiveColumns)
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
                {rowAuctions.map((auction) => (
                  <AuctionRow key={auction.id} auction={auction} nowSeconds={nowSeconds} />
                ))}
              </div>
            ) : (
              <div
                className="grid gap-5 pb-5"
                style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
              >
                {rowAuctions.map((auction) => (
                  <AuctionCard key={auction.id} auction={auction} nowSeconds={nowSeconds} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
