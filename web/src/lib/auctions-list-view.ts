// List-view state for the auctions screen: the typed view model, a total URL
// codec (shareable, default-on-malformed, never throws), and the pure
// filter/sort pipeline the list renders. No React here, so it is unit-testable
// in isolation and reused by both the RPC and indexer data paths. The list is
// virtualized (web/src/components/auction/AuctionsListBody.tsx), so the full
// filtered set is rendered windowed rather than paged.
// Why new: nothing existing modeled list query state or the filter/sort
// pipeline; the route held an inline sort only.

import { countFilledSlots, deriveAuctionTone, type AuctionTone, type AuctionView } from './chain'

export type AuctionSegment = 'all' | 'live' | 'closing' | 'awaiting' | 'settled' | 'yours'
export type AuctionSort = 'closing' | 'newest' | 'bids'
export type AuctionDensity = 'comfortable' | 'compact'

export type AuctionsListView = {
  segment: AuctionSegment
  search: string
  assetSymbol: string | null
  sort: AuctionSort
  density: AuctionDensity
}

// A renderable list entry: the auction plus an optional already-known clearing
// price. The indexer path supplies the clearing price (so the card does not
// fetch it again); the RPC path leaves it undefined and the card fetches it.
export type AuctionListItem = {
  view: AuctionView
  clearingPrice: bigint | null | undefined
}

// Final window of an open auction that counts as "closing soon".
// Unit: seconds. Source: this module (product choice for the list filter).
export const CLOSING_SOON_THRESHOLD_SECONDS = 3600
// Delay before a typed search term drives filtering (the input stays instant).
// Unit: milliseconds. Source: this module.
export const SEARCH_DEBOUNCE_MS = 180

const SEGMENTS: readonly AuctionSegment[] = ['all', 'live', 'closing', 'awaiting', 'settled', 'yours']
const SORTS: readonly AuctionSort[] = ['closing', 'newest', 'bids']
const DENSITIES: readonly AuctionDensity[] = ['comfortable', 'compact']

const DEFAULT_VIEW: AuctionsListView = {
  segment: 'all',
  search: '',
  assetSymbol: null,
  sort: 'closing',
  density: 'comfortable',
}

// URL parameter names kept short for shareable links.
const SEGMENT_PARAM = 'seg'
const SEARCH_PARAM = 'q'
const ASSET_PARAM = 'asset'
const SORT_PARAM = 'sort'
const DENSITY_PARAM = 'density'

// Live first, then awaiting, settled, refunded. Source: moved from
// web/src/routes/AuctionsRoute.tsx so all list sort logic has one home.
const TONE_ORDER: Record<AuctionTone, number> = { open: 0, awaiting: 1, settled: 2, refunded: 3 }

// Every parser below is total: an unknown or malformed value falls back to the
// default rather than throwing, because the input is untrusted URL text.
function parseSegment(rawValue: string | null): AuctionSegment {
  return SEGMENTS.find((segment) => segment === rawValue) ?? DEFAULT_VIEW.segment
}

function parseSort(rawValue: string | null): AuctionSort {
  return SORTS.find((sort) => sort === rawValue) ?? DEFAULT_VIEW.sort
}

function parseDensity(rawValue: string | null): AuctionDensity {
  return DENSITIES.find((density) => density === rawValue) ?? DEFAULT_VIEW.density
}

export function readListView(searchParams: URLSearchParams): AuctionsListView {
  const assetValue = searchParams.get(ASSET_PARAM)?.trim() ?? ''
  return {
    segment: parseSegment(searchParams.get(SEGMENT_PARAM)),
    search: searchParams.get(SEARCH_PARAM)?.trim() ?? DEFAULT_VIEW.search,
    assetSymbol: assetValue === '' ? null : assetValue,
    sort: parseSort(searchParams.get(SORT_PARAM)),
    density: parseDensity(searchParams.get(DENSITY_PARAM)),
  }
}

// Defaults are never written, so a bare "/" stays clean and shared links stay
// minimal.
export function writeListView(
  current: URLSearchParams,
  next: Partial<AuctionsListView>,
): URLSearchParams {
  const merged: AuctionsListView = { ...readListView(current), ...next }
  const params = new URLSearchParams()
  if (merged.segment !== DEFAULT_VIEW.segment) {
    params.set(SEGMENT_PARAM, merged.segment)
  }
  if (merged.search !== DEFAULT_VIEW.search) {
    params.set(SEARCH_PARAM, merged.search)
  }
  if (merged.assetSymbol !== null) {
    params.set(ASSET_PARAM, merged.assetSymbol)
  }
  if (merged.sort !== DEFAULT_VIEW.sort) {
    params.set(SORT_PARAM, merged.sort)
  }
  if (merged.density !== DEFAULT_VIEW.density) {
    params.set(DENSITY_PARAM, merged.density)
  }
  return params
}

export function isClosingSoon(view: AuctionView, nowSeconds: number): boolean {
  return (
    deriveAuctionTone(view, nowSeconds) === 'open' &&
    view.commitDeadlineSeconds - nowSeconds <= CLOSING_SOON_THRESHOLD_SECONDS
  )
}

export function matchesSegment(
  view: AuctionView,
  segment: AuctionSegment,
  nowSeconds: number,
  connectedAddress: string | null,
): boolean {
  const tone = deriveAuctionTone(view, nowSeconds)
  switch (segment) {
    case 'all':
      return true
    case 'live':
      return tone === 'open'
    case 'closing':
      return isClosingSoon(view, nowSeconds)
    case 'awaiting':
      return tone === 'awaiting'
    case 'settled':
      // Terminal states grouped under one tab so refunded auctions stay reachable.
      return tone === 'settled' || tone === 'refunded'
    case 'yours':
      return connectedAddress !== null && view.bids.some((bid) => bid.bidder === connectedAddress)
  }
}

export function matchesSearch(view: AuctionView, query: string): boolean {
  const trimmedQuery = query.trim().toLowerCase()
  if (trimmedQuery === '') {
    return true
  }
  if (String(view.id) === trimmedQuery) {
    return true
  }
  return (
    view.lotSymbol.toLowerCase().includes(trimmedQuery) ||
    view.paymentSymbol.toLowerCase().includes(trimmedQuery)
  )
}

export function matchesAssetChip(view: AuctionView, assetSymbol: string | null): boolean {
  if (assetSymbol === null) {
    return true
  }
  const target = assetSymbol.toLowerCase()
  return view.lotSymbol.toLowerCase() === target || view.paymentSymbol.toLowerCase() === target
}

// Distinct lot and payment symbols across the loaded auctions, sorted, so the
// filter chips render from live data rather than a hardcoded list.
export function collectAssetSymbols(auctions: AuctionView[]): string[] {
  const symbols = new Set<string>()
  for (const auction of auctions) {
    symbols.add(auction.lotSymbol)
    symbols.add(auction.paymentSymbol)
  }
  return [...symbols].sort((firstSymbol, secondSymbol) => firstSymbol.localeCompare(secondSymbol))
}

export function compareForSort(
  sort: AuctionSort,
  nowSeconds: number,
): (firstAuction: AuctionView, secondAuction: AuctionView) => number {
  if (sort === 'newest') {
    return (firstAuction, secondAuction) => secondAuction.id - firstAuction.id
  }
  if (sort === 'bids') {
    return (firstAuction, secondAuction) => {
      const slotDelta = countFilledSlots(secondAuction) - countFilledSlots(firstAuction)
      return slotDelta !== 0 ? slotDelta : secondAuction.id - firstAuction.id
    }
  }
  // 'closing': live auctions first by soonest deadline, then the tone order,
  // newest id first within a tone.
  return (firstAuction, secondAuction) => {
    const firstTone = deriveAuctionTone(firstAuction, nowSeconds)
    const secondTone = deriveAuctionTone(secondAuction, nowSeconds)
    if (firstTone !== secondTone) {
      return TONE_ORDER[firstTone] - TONE_ORDER[secondTone]
    }
    if (firstTone === 'open') {
      return firstAuction.commitDeadlineSeconds - secondAuction.commitDeadlineSeconds
    }
    return secondAuction.id - firstAuction.id
  }
}

export function selectVisibleAuctions(
  auctions: AuctionView[],
  view: AuctionsListView,
  nowSeconds: number,
  connectedAddress: string | null,
): AuctionView[] {
  const filtered = auctions.filter(
    (auction) =>
      matchesSegment(auction, view.segment, nowSeconds, connectedAddress) &&
      matchesSearch(auction, view.search) &&
      matchesAssetChip(auction, view.assetSymbol),
  )
  return filtered.sort(compareForSort(view.sort, nowSeconds))
}
