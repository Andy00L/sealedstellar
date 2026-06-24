// SQLite store for the indexed auctions. Reads serve the list API; writes come
// only from the ingester. Pagination is keyset (not offset) so paging stays
// stable as new auctions arrive. All reads are parameterized (named params),
// never string-concatenated, so query inputs cannot inject SQL.
// sourceRef: REFERENCE_SECURITY_AUDIT.md 3.3 (validate input, parameterize).

import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

import type {
  AuctionCursor,
  AuctionListRow,
  AuctionPage,
  AuctionQuery,
  AuctionSort,
  AuctionStatus,
} from './types'

export type AuctionCore = {
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
  lotReclaimed: boolean
}

type AuctionDbRow = {
  id: number
  seller: string
  rwa_token: string
  lot_symbol: string
  lot_amount: string
  payment_token: string
  payment_symbol: string
  max_price: string
  commit_deadline: number
  grace_period: number
  status: string
  filled_slots: number
  lot_reclaimed: number
  clearing_price: string | null
  winner: string | null
  settle_tx: string | null
}

// 1e13, above any Unix-second deadline, so the closing-soonest sort can pack
// "open first" into the high digits and the deadline into the low digits as one
// comparable number. Unit: dimensionless sort key. Source: this module.
const OPEN_RANK_MULTIPLIER = 10_000_000_000_000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY,
  seller TEXT NOT NULL,
  rwa_token TEXT NOT NULL,
  lot_symbol TEXT NOT NULL,
  lot_amount TEXT NOT NULL,
  payment_token TEXT NOT NULL,
  payment_symbol TEXT NOT NULL,
  max_price TEXT NOT NULL,
  commit_deadline INTEGER NOT NULL,
  grace_period INTEGER NOT NULL,
  status TEXT NOT NULL,
  filled_slots INTEGER NOT NULL DEFAULT 0,
  lot_reclaimed INTEGER NOT NULL DEFAULT 1,
  clearing_price TEXT,
  winner TEXT,
  settle_tx TEXT
);
CREATE TABLE IF NOT EXISTS bids (
  auction_id INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  bidder TEXT NOT NULL,
  PRIMARY KEY (auction_id, slot_index)
);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids (bidder);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions (status);
CREATE INDEX IF NOT EXISTS idx_auctions_deadline ON auctions (commit_deadline);
CREATE TABLE IF NOT EXISTS ingest_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER,
  last_cursor TEXT
);
`

function parseStatus(rawStatus: string): AuctionStatus {
  if (rawStatus === 'Open' || rawStatus === 'Settled' || rawStatus === 'Refunded') {
    return rawStatus
  }
  // The store only ever writes valid statuses, so this is defensive; an unknown
  // value reads as Open rather than throwing in a read path.
  return 'Open'
}

function toListRow(row: AuctionDbRow): AuctionListRow {
  return {
    id: row.id,
    seller: row.seller,
    rwaToken: row.rwa_token,
    lotSymbol: row.lot_symbol,
    lotAmount: row.lot_amount,
    paymentToken: row.payment_token,
    paymentSymbol: row.payment_symbol,
    maxPrice: row.max_price,
    commitDeadlineSeconds: row.commit_deadline,
    gracePeriodSeconds: row.grace_period,
    status: parseStatus(row.status),
    filledSlots: row.filled_slots,
    lotReclaimed: row.lot_reclaimed === 1,
    clearingPrice: row.clearing_price,
    winner: row.winner,
    settleTxHash: row.settle_tx,
  }
}

function sortValueOf(row: AuctionDbRow, sort: AuctionSort): number {
  if (sort === 'mostBids') {
    return row.filled_slots
  }
  if (sort === 'closingSoonest') {
    return (row.status === 'Open' ? 0 : 1) * OPEN_RANK_MULTIPLIER + row.commit_deadline
  }
  return row.id
}

// SQL expression for the closing-soonest sort key (open auctions first, then
// earliest deadline), used both in ORDER BY and the keyset cursor comparison.
const CLOSING_SORT_EXPR = `((CASE WHEN status = 'Open' THEN 0 ELSE 1 END) * ${OPEN_RANK_MULTIPLIER} + commit_deadline)`

type OrderPlan = { orderBy: string; cursorClause: string }

function planOrder(sort: AuctionSort, hasCursor: boolean): OrderPlan {
  if (sort === 'mostBids') {
    return {
      orderBy: 'filled_slots DESC, id DESC',
      cursorClause: hasCursor
        ? '(filled_slots < @cursorSort OR (filled_slots = @cursorSort AND id < @cursorId))'
        : '',
    }
  }
  if (sort === 'closingSoonest') {
    return {
      orderBy: `${CLOSING_SORT_EXPR} ASC, id ASC`,
      cursorClause: hasCursor
        ? `(${CLOSING_SORT_EXPR} > @cursorSort OR (${CLOSING_SORT_EXPR} = @cursorSort AND id > @cursorId))`
        : '',
    }
  }
  return {
    orderBy: 'id DESC',
    cursorClause: hasCursor ? 'id < @cursorId' : '',
  }
}

export class AuctionStore {
  private readonly db: Database.Database

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  upsertCore(core: AuctionCore): void {
    this.db
      .prepare(
        `INSERT INTO auctions
          (id, seller, rwa_token, lot_symbol, lot_amount, payment_token, payment_symbol,
           max_price, commit_deadline, grace_period, status, lot_reclaimed)
         VALUES
          (@id, @seller, @rwaToken, @lotSymbol, @lotAmount, @paymentToken, @paymentSymbol,
           @maxPrice, @commitDeadlineSeconds, @gracePeriodSeconds, @status, @lotReclaimed)
         ON CONFLICT(id) DO UPDATE SET
           seller = excluded.seller,
           rwa_token = excluded.rwa_token,
           lot_symbol = excluded.lot_symbol,
           lot_amount = excluded.lot_amount,
           payment_token = excluded.payment_token,
           payment_symbol = excluded.payment_symbol,
           max_price = excluded.max_price,
           commit_deadline = excluded.commit_deadline,
           grace_period = excluded.grace_period,
           status = excluded.status,
           lot_reclaimed = excluded.lot_reclaimed`,
      )
      .run({
        id: core.id,
        seller: core.seller,
        rwaToken: core.rwaToken,
        lotSymbol: core.lotSymbol,
        lotAmount: core.lotAmount,
        paymentToken: core.paymentToken,
        paymentSymbol: core.paymentSymbol,
        maxPrice: core.maxPrice,
        commitDeadlineSeconds: core.commitDeadlineSeconds,
        gracePeriodSeconds: core.gracePeriodSeconds,
        status: core.status,
        lotReclaimed: core.lotReclaimed ? 1 : 0,
      })
  }

  hasAuction(id: number): boolean {
    const row = this.db.prepare('SELECT 1 FROM auctions WHERE id = @id').get({ id })
    return row !== undefined
  }

  recordBid(auctionId: number, slotIndex: number, bidder: string): void {
    const insertBid = this.db.prepare(
      `INSERT OR IGNORE INTO bids (auction_id, slot_index, bidder)
       VALUES (@auctionId, @slotIndex, @bidder)`,
    )
    const refreshCount = this.db.prepare(
      `UPDATE auctions
         SET filled_slots = (SELECT COUNT(*) FROM bids WHERE auction_id = @auctionId)
       WHERE id = @auctionId`,
    )
    const apply = this.db.transaction(() => {
      insertBid.run({ auctionId, slotIndex, bidder })
      refreshCount.run({ auctionId })
    })
    apply()
  }

  markSettled(auctionId: number, clearingPrice: string, winner: string, settleTxHash: string | null): void {
    this.db
      .prepare(
        `UPDATE auctions
           SET status = 'Settled', clearing_price = @clearingPrice, winner = @winner, settle_tx = @settleTx
         WHERE id = @auctionId`,
      )
      .run({ auctionId, clearingPrice, winner, settleTx: settleTxHash })
  }

  markRefunded(auctionId: number): void {
    this.db
      .prepare(`UPDATE auctions SET status = 'Refunded' WHERE id = @auctionId`)
      .run({ auctionId })
  }

  setLotReclaimed(auctionId: number, reclaimed: boolean): void {
    this.db
      .prepare('UPDATE auctions SET lot_reclaimed = @reclaimed WHERE id = @auctionId')
      .run({ auctionId, reclaimed: reclaimed ? 1 : 0 })
  }

  getCursor(): { lastLedger: number | null; lastCursor: string | null } {
    const row = this.db
      .prepare('SELECT last_ledger AS lastLedger, last_cursor AS lastCursor FROM ingest_cursor WHERE id = 1')
      .get() as { lastLedger: number | null; lastCursor: string | null } | undefined
    return row ?? { lastLedger: null, lastCursor: null }
  }

  setCursor(lastLedger: number | null, lastCursor: string | null): void {
    this.db
      .prepare(
        `INSERT INTO ingest_cursor (id, last_ledger, last_cursor) VALUES (1, @lastLedger, @lastCursor)
         ON CONFLICT(id) DO UPDATE SET last_ledger = excluded.last_ledger, last_cursor = excluded.last_cursor`,
      )
      .run({ lastLedger, lastCursor })
  }

  auctionCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM auctions').get() as { total: number }
    return row.total
  }

  getById(id: number): AuctionListRow | null {
    const row = this.db.prepare('SELECT * FROM auctions WHERE id = @id').get({ id }) as
      | AuctionDbRow
      | undefined
    return row === undefined ? null : toListRow(row)
  }

  query(auctionQuery: AuctionQuery): AuctionPage {
    const conditions: string[] = []
    const params: Record<string, string | number> = {}

    if (auctionQuery.statuses.length > 0 && auctionQuery.statuses.length < 3) {
      const placeholders = auctionQuery.statuses.map((status, index) => {
        params[`status${index}`] = status
        return `@status${index}`
      })
      conditions.push(`status IN (${placeholders.join(', ')})`)
    }
    if (auctionQuery.assetSymbol !== null) {
      params.asset = auctionQuery.assetSymbol.toLowerCase()
      conditions.push('(lower(lot_symbol) = @asset OR lower(payment_symbol) = @asset)')
    }
    if (auctionQuery.search !== null) {
      params.searchExact = auctionQuery.search
      params.searchLike = `%${auctionQuery.search.toLowerCase()}%`
      conditions.push(
        '(CAST(id AS TEXT) = @searchExact OR lower(lot_symbol) LIKE @searchLike OR lower(payment_symbol) LIKE @searchLike)',
      )
    }
    if (auctionQuery.bidder !== null) {
      params.bidder = auctionQuery.bidder
      conditions.push('EXISTS (SELECT 1 FROM bids WHERE bids.auction_id = auctions.id AND bids.bidder = @bidder)')
    }

    const filterWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM auctions ${filterWhere}`)
      .get(params) as { total: number }

    const plan = planOrder(auctionQuery.sort, auctionQuery.cursor !== null)
    const pageConditions = [...conditions]
    if (auctionQuery.cursor !== null && plan.cursorClause !== '') {
      params.cursorSort = auctionQuery.cursor.sortValue
      params.cursorId = auctionQuery.cursor.id
      pageConditions.push(plan.cursorClause)
    }
    const pageWhere = pageConditions.length > 0 ? `WHERE ${pageConditions.join(' AND ')}` : ''

    // Fetch one extra row to know whether a next page exists.
    params.pageLimit = auctionQuery.limit + 1
    const rows = this.db
      .prepare(`SELECT * FROM auctions ${pageWhere} ORDER BY ${plan.orderBy} LIMIT @pageLimit`)
      .all(params) as AuctionDbRow[]

    const hasMore = rows.length > auctionQuery.limit
    const pageRows = hasMore ? rows.slice(0, auctionQuery.limit) : rows
    const lastRow = pageRows.at(-1)
    const nextCursor: AuctionCursor | null =
      hasMore && lastRow !== undefined
        ? { sortValue: sortValueOf(lastRow, auctionQuery.sort), id: lastRow.id }
        : null

    return {
      rows: pageRows.map(toListRow),
      nextCursor: nextCursor === null ? null : encodeCursor(nextCursor),
      totalCount: totalRow.total,
    }
  }
}

// Opaque base64url cursor carrying the keyset (sortValue, id). Encoding keeps
// the API surface from leaking the sort internals and is validated on decode.
export function encodeCursor(cursor: AuctionCursor): string {
  return Buffer.from(`${cursor.sortValue}:${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(rawCursor: string): AuctionCursor | null {
  let decoded: string
  try {
    decoded = Buffer.from(rawCursor, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const parts = decoded.split(':')
  if (parts.length !== 2) {
    return null
  }
  const sortValue = Number(parts[0])
  const id = Number(parts[1])
  if (!Number.isFinite(sortValue) || !Number.isInteger(id) || id < 0) {
    return null
  }
  return { sortValue, id }
}
