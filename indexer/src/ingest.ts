// Ingestion: a one-time startup backfill over the dense auction id space (so the
// index is complete from id 1, even for auctions older than the event-retention
// window), then a live loop that follows the contract events forward. The
// indexer reads only public chain data, stores ciphertext-free summaries, and
// never decrypts anything. sourceRef: web/src/lib/chain.ts, prover/fetch-bid-events.js.

import {
  fetchContractEvents,
  getAuction,
  getLatestLedger,
  getTokenSymbol,
  type IndexedEvent,
} from './chain'
import { AuctionStore, type AuctionCore } from './store'
import { BACKFILL_MAX_ID, POLL_INTERVAL_MS } from './config'

// AuctionNotFound is contract error #1. sourceRef: web/src/lib/errors.ts.
const AUCTION_NOT_FOUND_CODE = 1
// Lookback for the first event sync, inside the ~7-day testnet retention window.
// sourceRef: web/src/lib/chain.ts EVENT_LOOKBACK_LEDGERS.
const EVENT_LOOKBACK_LEDGERS = 100_000

function log(scope: string, message: string): void {
  console.log(`[ingest:${scope}] ${message}`)
}

// Reads the full auction from chain, resolves both token symbols, and upserts
// the core row plus its bids. Returns 'not_found' at the end of the id space,
// 'indexed' on success, 'skipped' on a transient read failure (retry later).
async function enrichAndUpsert(
  store: AuctionStore,
  auctionId: number,
): Promise<'indexed' | 'not_found' | 'skipped'> {
  const decoded = await getAuction(auctionId)
  if (!decoded.ok) {
    if (decoded.error.kind === 'contract_error' && decoded.error.code === AUCTION_NOT_FOUND_CODE) {
      return 'not_found'
    }
    log('enrich', `auction ${auctionId} read failed (${decoded.error.kind}); will retry`)
    return 'skipped'
  }
  const auction = decoded.value
  const lotSymbolResult = await getTokenSymbol(auction.rwaToken)
  const paymentSymbolResult = await getTokenSymbol(auction.paymentToken)
  if (!lotSymbolResult.ok || !paymentSymbolResult.ok) {
    log('enrich', `auction ${auctionId} symbol read failed; will retry`)
    return 'skipped'
  }
  const core: AuctionCore = {
    id: auctionId,
    seller: auction.seller,
    rwaToken: auction.rwaToken,
    lotSymbol: lotSymbolResult.value,
    lotAmount: auction.lotAmount,
    paymentToken: auction.paymentToken,
    paymentSymbol: paymentSymbolResult.value,
    maxPrice: auction.maxPrice,
    commitDeadlineSeconds: auction.commitDeadlineSeconds,
    gracePeriodSeconds: auction.gracePeriodSeconds,
    status: auction.status,
    lotReclaimed: auction.lotReclaimed,
  }
  store.upsertCore(core)
  for (const bid of auction.bids) {
    store.recordBid(auctionId, bid.slotIndex, bid.bidder)
  }
  return 'indexed'
}

async function backfill(store: AuctionStore): Promise<void> {
  log('backfill', `probing get_auction from id 1 (cap ${BACKFILL_MAX_ID})`)
  let indexedCount = 0
  for (let auctionId = 1; auctionId <= BACKFILL_MAX_ID; auctionId += 1) {
    const outcome = await enrichAndUpsert(store, auctionId)
    if (outcome === 'not_found') {
      break
    }
    if (outcome === 'indexed') {
      indexedCount += 1
    }
  }
  log('backfill', `indexed ${indexedCount} auctions, store now holds ${store.auctionCount()}`)
}

async function applyEvent(store: AuctionStore, event: IndexedEvent): Promise<void> {
  switch (event.name) {
    case 'auction_created': {
      // Enrich only if not already present (backfill or an earlier event), so a
      // created event does not re-read an auction we already have.
      if (!store.hasAuction(event.auctionId)) {
        await enrichAndUpsert(store, event.auctionId)
      }
      return
    }
    case 'bid_placed': {
      const slotIndex = event.payload.slot_index
      const bidder = event.payload.bidder
      if (typeof bidder === 'string' && (typeof slotIndex === 'bigint' || typeof slotIndex === 'number')) {
        store.recordBid(event.auctionId, Number(slotIndex), bidder)
      }
      return
    }
    case 'auction_settled': {
      const winner = event.payload.winner
      const winningPrice = event.payload.winning_price
      if (typeof winner === 'string' && typeof winningPrice === 'bigint') {
        store.markSettled(event.auctionId, winningPrice.toString(), winner, event.txHash ?? null)
      }
      return
    }
    case 'auction_refunded': {
      store.markRefunded(event.auctionId)
      return
    }
    case 'lot_return_failed': {
      store.setLotReclaimed(event.auctionId, false)
      return
    }
    case 'lot_reclaimed': {
      store.setLotReclaimed(event.auctionId, true)
      return
    }
    default:
      return
  }
}

async function syncEvents(store: AuctionStore): Promise<void> {
  const latest = await getLatestLedger()
  if (!latest.ok) {
    log('sync', `getLatestLedger failed (${latest.error.kind}); will retry next tick`)
    return
  }
  const saved = store.getCursor()
  const startLedger = saved.lastLedger ?? Math.max(1, latest.value - EVENT_LOOKBACK_LEDGERS)
  const fetched = await fetchContractEvents(startLedger)
  if (!fetched.ok) {
    log('sync', `fetchContractEvents failed (${fetched.error.kind}); will retry next tick`)
    return
  }
  for (const event of fetched.value.events) {
    await applyEvent(store, event)
  }
  // Resume from the last seen ledger next tick; reprocessing it is idempotent.
  store.setCursor(fetched.value.latestLedger, null)
  if (fetched.value.events.length > 0) {
    log('sync', `applied ${fetched.value.events.length} events up to ledger ${fetched.value.latestLedger}`)
  }
}

// Runs the backfill once, an initial event sync (to fill clearing prices and
// recent state), then keeps syncing on an interval. Returns the timer so the
// caller can clear it on shutdown. Overlapping ticks are guarded.
export async function startIngestion(store: AuctionStore): Promise<NodeJS.Timeout> {
  await backfill(store)
  await syncEvents(store)
  let isSyncing = false
  const timer = setInterval(() => {
    if (isSyncing) {
      return
    }
    isSyncing = true
    void syncEvents(store).finally(() => {
      isSyncing = false
    })
  }, POLL_INTERVAL_MS)
  return timer
}

export { syncEvents }
