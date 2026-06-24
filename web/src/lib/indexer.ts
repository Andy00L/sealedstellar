// Off-chain indexer client: fetches a filtered, sorted, cursor-paginated page of
// auctions from the indexer service and adapts each row into the AuctionView
// shape the list already renders, so the UI stays source-agnostic. Errors
// travel as values; the route falls back to direct RPC reads when the indexer
// is unreachable. sourceRef: indexer/src/api.ts (the served shape).

import { INDEXER_BASE_URL } from '../config'
import type { Result } from './errors'
import type { AuctionStatusName, AuctionView } from './chain'
import type { AuctionListItem, AuctionSegment, AuctionsListView } from './auctions-list-view'

export type IndexerError =
  | { kind: 'indexer_unreachable'; detail: string }
  | { kind: 'bad_response'; detail: string }

type IndexerRow = {
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
  status: AuctionStatusName
  filledSlots: number
  lotReclaimed: boolean
  clearingPrice: string | null
  winner: string | null
  settleTxHash: string | null
}

type IndexerPageResponse = {
  rows: IndexerRow[]
  nextCursor: string | null
  totalCount: number
}

export type IndexerPage = {
  items: AuctionListItem[]
  nextCursor: string | null
  totalCount: number
}

function parseBigIntOrZero(text: string): bigint {
  try {
    return BigInt(text)
  } catch {
    return 0n
  }
}

function parseClearingPrice(rawValue: string | null): bigint | null {
  if (rawValue === null) {
    return null
  }
  try {
    return BigInt(rawValue)
  } catch {
    return null
  }
}

// Adapts a lightweight indexer row into the AuctionView the card renders. The
// list reads only id, amounts, symbols, status, deadline, and the slot COUNT,
// so the bids array is synthesized to the right length with placeholder entries
// (the indexer never returns bidder identities in the list, and the "Yours"
// filter is a server-side bidder query, so no real bidder data is needed here).
// The fields the list never reads (operator key, whitelist root) are empty.
function rowToView(row: IndexerRow): AuctionView {
  const placeholderBids = Array.from({ length: Math.max(0, row.filledSlots) }, () => ({
    bidder: '',
    commitment: 0n,
  }))
  return {
    id: row.id,
    seller: row.seller,
    rwaToken: row.rwaToken,
    lotAmount: parseBigIntOrZero(row.lotAmount),
    paymentToken: row.paymentToken,
    maxPrice: parseBigIntOrZero(row.maxPrice),
    commitDeadlineSeconds: row.commitDeadlineSeconds,
    gracePeriodSeconds: row.gracePeriodSeconds,
    status: row.status,
    bids: placeholderBids,
    lotReclaimed: row.lotReclaimed,
    operatorEncPubkey: new Uint8Array(),
    whitelistRoot: 0n,
    lotSymbol: row.lotSymbol,
    paymentSymbol: row.paymentSymbol,
  }
}

// Tone tabs collapse to the on-chain status the indexer stores: open auctions
// share one status, terminal auctions another. The finer open/awaiting/closing
// distinction (which depends on the current clock) stays a client concern on
// the RPC path; the indexer path treats those three tabs as "on-chain Open".
const SEGMENT_STATUS: Record<AuctionSegment, AuctionStatusName[]> = {
  all: [],
  live: ['Open'],
  closing: ['Open'],
  awaiting: ['Open'],
  settled: ['Settled', 'Refunded'],
  yours: [],
}

function mapSort(sort: AuctionsListView['sort']): string {
  if (sort === 'newest') {
    return 'newest'
  }
  if (sort === 'bids') {
    return 'mostBids'
  }
  return 'closingSoonest'
}

export function buildAuctionQuery(
  view: AuctionsListView,
  connectedAddress: string | null,
  cursor: string | null,
  limit: number,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const status of SEGMENT_STATUS[view.segment]) {
    params.append('status', status)
  }
  const trimmedSearch = view.search.trim()
  if (trimmedSearch !== '') {
    params.set('search', trimmedSearch)
  }
  if (view.assetSymbol !== null) {
    params.set('assetSymbol', view.assetSymbol)
  }
  if (view.segment === 'yours' && connectedAddress !== null) {
    params.set('bidder', connectedAddress)
  }
  params.set('sort', mapSort(view.sort))
  params.set('limit', String(limit))
  if (cursor !== null) {
    params.set('cursor', cursor)
  }
  return params
}

export async function fetchAuctionPage(
  query: URLSearchParams,
): Promise<Result<IndexerPage, IndexerError>> {
  let response: Response
  try {
    response = await fetch(`${INDEXER_BASE_URL}/auctions?${query.toString()}`, {
      headers: { accept: 'application/json' },
    })
  } catch (networkError) {
    return {
      ok: false,
      error: {
        kind: 'indexer_unreachable',
        detail: networkError instanceof Error ? networkError.message : String(networkError),
      },
    }
  }
  if (!response.ok) {
    return { ok: false, error: { kind: 'bad_response', detail: `indexer returned ${response.status}` } }
  }
  let payload: IndexerPageResponse
  try {
    payload = (await response.json()) as IndexerPageResponse
  } catch (parseError) {
    return {
      ok: false,
      error: {
        kind: 'bad_response',
        detail: parseError instanceof Error ? parseError.message : String(parseError),
      },
    }
  }
  if (!Array.isArray(payload.rows)) {
    return { ok: false, error: { kind: 'bad_response', detail: 'indexer response is missing rows' } }
  }
  return {
    ok: true,
    value: {
      items: payload.rows.map((row) => ({
        view: rowToView(row),
        clearingPrice: parseClearingPrice(row.clearingPrice),
      })),
      nextCursor: payload.nextCursor,
      totalCount: payload.totalCount,
    },
  }
}
