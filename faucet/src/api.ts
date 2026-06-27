// Faucet HTTP API: a single write endpoint that mints fixed amounts of the mock
// assets to a validated address. CORS is restricted to the configured web
// origins, a per-IP token bucket caps request rate, and a per-address cooldown
// stops a single wallet from draining the issuer. Every failure carries a
// distinct status code, and the client never chooses the amount.
// sourceRef: indexer/src/api.ts (cors + token bucket + getConnInfo + validation),
// REFERENCE_SECURITY_AUDIT.md 3.3 / 3.5.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getConnInfo } from '@hono/node-server/conninfo'
import { StrKey } from '@stellar/stellar-sdk'

import { ALLOWED_ORIGINS, FAUCET_COOLDOWN_MS, ISSUER_ALIAS, NETWORK } from './config'
import { grantTestTokens } from './mint'
import type { FaucetError } from './result'

// Token bucket per client IP. Capacity 10, refill 0.2/second (one token every
// 5s): a tester can fund a few wallets in a burst, a script is throttled.
// Unit: requests. sourceRef: indexer/src/api.ts takeToken.
const RATE_CAPACITY = 10
const RATE_REFILL_PER_SECOND = 0.2
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

// Per-destination cooldown: one successful grant per address per
// FAUCET_COOLDOWN_MS, recorded only on success. Unit: epoch ms of last grant.
const lastGrantMsByAddress = new Map<string, number>()

function cooldownRemainingMs(address: string): number {
  const lastMs = lastGrantMsByAddress.get(address)
  if (lastMs === undefined) {
    return 0
  }
  const elapsedMs = Date.now() - lastMs
  return elapsedMs >= FAUCET_COOLDOWN_MS ? 0 : FAUCET_COOLDOWN_MS - elapsedMs
}

function httpStatusForError(error: FaucetError): 400 | 429 | 502 {
  switch (error.kind) {
    case 'bad_request':
      return 400
    case 'no_trustline':
      return 400
    case 'rate_limited':
      return 429
    case 'mint_failed':
      return 502
    case 'chain_unreachable':
      return 502
  }
}

function describeFaucetError(error: FaucetError): string {
  switch (error.kind) {
    case 'bad_request':
      return error.detail
    case 'rate_limited':
      return error.detail
    case 'no_trustline':
      return 'the destination has no trustline for the asset; add it before requesting tokens'
    case 'mint_failed':
      return `mint failed: ${error.detail}`
    case 'chain_unreachable':
      return 'testnet rpc is not answering; retry shortly'
  }
}

// Reads the destination address from an unknown JSON body without an unsafe cast:
// narrows to an object that carries an `address` key, then checks it is a string.
function readAddress(body: unknown): string {
  if (body === null || typeof body !== 'object' || !('address' in body)) {
    return ''
  }
  const candidate = body.address
  return typeof candidate === 'string' ? candidate.trim() : ''
}

export function createApi(): Hono {
  const app = new Hono()

  app.use(
    '*',
    cors({ origin: ALLOWED_ORIGINS, allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }),
  )

  app.use('*', async (c, next) => {
    const clientIp = getConnInfo(c).remote.address ?? 'unknown'
    if (!takeToken(clientIp)) {
      return c.json({ error: { kind: 'rate_limited', message: 'too many requests; slow down' } }, 429, {
        'Retry-After': '5',
      })
    }
    await next()
  })

  app.get('/healthz', (c) => {
    return c.json({ ok: true, network: NETWORK, issuerAlias: ISSUER_ALIAS })
  })

  app.post('/faucet', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { kind: 'bad_request', message: 'body must be JSON: { "address": "G..." }' } }, 400)
    }
    const address = readAddress(body)
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return c.json(
        { error: { kind: 'bad_request', message: 'address must be a valid Stellar account (G...)' } },
        400,
      )
    }

    const remainingMs = cooldownRemainingMs(address)
    if (remainingMs > 0) {
      const remainingSeconds = Math.ceil(remainingMs / 1000)
      return c.json(
        {
          error: {
            kind: 'rate_limited',
            message: `already funded; wait ${remainingSeconds}s before requesting again`,
          },
        },
        429,
        { 'Retry-After': String(remainingSeconds) },
      )
    }

    const granted = await grantTestTokens(address)
    if (!granted.ok) {
      return c.json(
        { error: { kind: granted.error.kind, message: describeFaucetError(granted.error) } },
        httpStatusForError(granted.error),
      )
    }
    lastGrantMsByAddress.set(address, Date.now())
    return c.json({ ok: true, address, grants: granted.value })
  })

  return app
}
