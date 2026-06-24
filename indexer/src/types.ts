// The lightweight row the auctions list renders. It deliberately omits the
// heavy fields of the full on-chain Auction struct (the bids vec, the operator
// key, the whitelist root): the list never needs them, which is the whole point
// of the indexer. sourceRef: web/src/lib/chain.ts AuctionView.

export type AuctionStatus = 'Open' | 'Settled' | 'Refunded'

// BigInts cross the JSON boundary as decimal strings (BigInt is not
// JSON-serializable); the web client reparses them. sourceRef:
// REFERENCE_SECURITY_AUDIT.md serialization-boundaries rule.
export type AuctionListRow = {
  id: number
  seller: string
  rwaToken: string
  lotSymbol: string
  lotAmount: string
  paymentToken: string
  paymentSymbol: string
  maxPrice: string
  commitDeadlineSeconds: number
  gracePeriodSeconds: number
  status: AuctionStatus
  filledSlots: number
  lotReclaimed: boolean
  // Vickrey clearing price (from the AuctionSettled event); null when settled
  // outside the event-retention window or not yet settled.
  clearingPrice: string | null
  winner: string | null
  settleTxHash: string | null
}

export type AuctionPage = {
  rows: AuctionListRow[]
  nextCursor: string | null
  totalCount: number
}

export type AuctionSort = 'closingSoonest' | 'newest' | 'mostBids'

// Validated query for GET /auctions. Every field is already narrowed from
// untrusted input by the time the store sees it.
export type AuctionQuery = {
  statuses: AuctionStatus[]
  assetSymbol: string | null
  search: string | null
  bidder: string | null
  sort: AuctionSort
  limit: number
  cursor: AuctionCursor | null
}

// Keyset pagination cursor: the (sortKey, id) of the last row of the previous
// page, so paging stays stable as new auctions arrive (offset pagination would
// double-show rows when a new row is inserted at the top).
export type AuctionCursor = {
  sortValue: number
  id: number
}
