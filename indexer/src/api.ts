// Read-only HTTP API over the indexed auctions. Every query input is validated
// and narrowed before the store sees it, responses carry distinct status codes
// per failure mode, CORS is restricted to the configured web origins, and a
// per-IP token bucket caps request rate. No write endpoints exist.
// sourceRef: REFERENCE_SECURITY_AUDIT.md 3.3 / 3.5 (validate, distinct errors,
// rate limit).

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getConnInfo } from '@hono/node-server/conninfo'
import { StrKey } from '@stellar/stellar-sdk'

import { ALLOWED_ORIGINS } from './config'
import { AuctionStore, decodeCursor } from './store'
import type { IndexerError, Result } from './result'
import type { AuctionQuery, AuctionSort, AuctionStatus } from './types'

const VALID_STATUSES = new Set<string>(['Open', 'Settled', 'Refunded'])
const VALID_SORTS = new Set<string>(['closingSoonest', 'newest', 'mostBids'])
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100
const MAX_SEARCH_LENGTH = 64
const MAX_SYMBOL_LENGTH = 24

// Token bucket per client IP. Capacity 60, refill 30/second: bursts allowed, a
// flood throttled. Unit: requests. Source: this module.
const RATE_CAPACITY = 60
const RATE_REFILL_PER_SECOND = 30
const rateBuckets = new Map<string, { tokens: number; lastRefillMs: number }>()

function takeToken(clientIp: string): boolean {
  const nowMs = Date.now()
  const bucket = rateBuckets.get(clientIp) ?? { tokens: RATE_CAPACITY, lastRefillMs: nowMs }
  const elapsedSeconds = (nowMs - bucket.lastRefillMs) / 1000
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + elapsedSeconds * RATE_REFILL_PER_SECOND)
  bucket.lastRefillMs = nowMs
  if (bucket.tokens < 1) {
    rateBuckets.set(clientIp, bucket)
    return false
  }
  bucket.tokens -= 1
  rateBuckets.set(clientIp, bucket)
  return true
}

function badRequest(detail: string): { ok: false; error: IndexerError } {
  return { ok: false, error: { kind: 'bad_request', detail } }
}

function parseAuctionQuery(
  statusValues: string[],
  assetRaw: string | undefined,
  searchRaw: string | undefined,
  bidderRaw: string | undefined,
  sortRaw: string | undefined,
  limitRaw: string | undefined,
  cursorRaw: string | undefined,
): Result<AuctionQuery, IndexerError> {
  const statuses: AuctionStatus[] = []
  for (const statusValue of statusValues) {
    if (!VALID_STATUSES.has(statusValue)) {
      return badRequest(`unknown status "${statusValue}"; expected Open, Settled, or Refunded`)
    }
    statuses.push(statusValue as AuctionStatus)
  }

  let assetSymbol: string | null = null
  if (assetRaw !== undefined && assetRaw.trim() !== '') {
    if (assetRaw.length > MAX_SYMBOL_LENGTH) {
      return badRequest('assetSymbol is too long')
    }
    assetSymbol = assetRaw.trim()
  }

  let search: string | null = null
  if (searchRaw !== undefined && searchRaw.trim() !== '') {
    if (searchRaw.length > MAX_SEARCH_LENGTH) {
      return badRequest('search is too long')
    }
    search = searchRaw.trim()
  }

  let bidder: string | null = null
  if (bidderRaw !== undefined && bidderRaw.trim() !== '') {
    if (!StrKey.isValidEd25519PublicKey(bidderRaw.trim())) {
      return badRequest('bidder must be a valid Stellar account address')
    }
    bidder = bidderRaw.trim()
  }

  let sort: AuctionSort = 'closingSoonest'
  if (sortRaw !== undefined && sortRaw !== '') {
    if (!VALID_SORTS.has(sortRaw)) {
      return badRequest(`unknown sort "${sortRaw}"; expected closingSoonest, newest, or mostBids`)
    }
    sort = sortRaw as AuctionSort
  }

  let limit = DEFAULT_LIMIT
  if (limitRaw !== undefined && limitRaw !== '') {
    const parsedLimit = Number(limitRaw)
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`)
    }
    limit = parsedLimit
  }

  let cursor: AuctionQuery['cursor'] = null
  if (cursorRaw !== undefined && cursorRaw !== '') {
    const decoded = decodeCursor(cursorRaw)
    if (decoded === null) {
      return badRequest('cursor is malformed')
    }
    cursor = decoded
  }

  return { ok: true, value: { statuses, assetSymbol, search, bidder, sort, limit, cursor } }
}

export function createApi(store: AuctionStore): Hono {
  const app = new Hono()

  app.use('*', cors({ origin: ALLOWED_ORIGINS, allowMethods: ['GET', 'OPTIONS'] }))

  app.use('*', async (c, next) => {
    const clientIp = getConnInfo(c).remote.address ?? 'unknown'
    if (!takeToken(clientIp)) {
      return c.json({ error: { kind: 'rate_limited', message: 'too many requests' } }, 429, {
        'Retry-After': '1',
      })
    }
    await next()
  })

  app.get('/healthz', (c) => {
    const cursor = store.getCursor()
    return c.json({
      ok: true,
      auctionCount: store.auctionCount(),
      lastIngestedLedger: cursor.lastLedger,
    })
  })

  app.get('/auctions', (c) => {
    const parsed = parseAuctionQuery(
      c.req.queries('status') ?? [],
      c.req.query('assetSymbol'),
      c.req.query('search'),
      c.req.query('bidder'),
      c.req.query('sort'),
      c.req.query('limit'),
      c.req.query('cursor'),
    )
    if (!parsed.ok) {
      return c.json({ error: { kind: parsed.error.kind, message: describeError(parsed.error) } }, 400)
    }
    return c.json(store.query(parsed.value))
  })

  app.get('/auctions/:id', (c) => {
    const idText = c.req.param('id')
    const id = Number(idText)
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: { kind: 'bad_request', message: 'id must be a positive integer' } }, 400)
    }
    const row = store.getById(id)
    if (row === null) {
      return c.json({ error: { kind: 'not_found', message: `auction ${id} not indexed` } }, 404)
    }
    return c.json(row)
  })

  return app
}

function describeError(error: IndexerError): string {
  return error.kind === 'rate_limited' ? 'too many requests' : error.detail
}
