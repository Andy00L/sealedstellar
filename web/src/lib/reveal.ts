// Client for the reveal endpoint (web/api/reveal.ts). Asks the server to decrypt
// a closed auction's sealed bids with the operator box secret (which stays
// server-side) and returns the plaintext bids. The browser then proves and the
// wallet settles, so the box secret never enters the bundle and no operator
// session file is loaded. Errors travel as a Result, never a throw.
// sourceRef: web/api/reveal.ts, web/src/lib/faucet.ts.

import type { Result } from './errors'

// One decrypted bid, decimal strings so bigints survive JSON.
// sourceRef: web/api/reveal.ts RevealedBid.
export type RevealedBid = {
  slotIndex: number
  bidder: string
  commitment: string
  price: string
  salt: string
}

export type RevealResult =
  | { kind: 'revealed'; bids: RevealedBid[]; members: string[]; whitelistRoot: string }
  | { kind: 'already_settled' }

const REVEAL_ENDPOINT = '/api/reveal'

type RevealResponseBody = {
  ok?: boolean
  alreadySettled?: boolean
  whitelistRoot?: unknown
  members?: unknown
  bids?: unknown
  error?: { kind?: string; message?: string }
}

function parseRevealedBids(rawBids: unknown): RevealedBid[] | null {
  if (!Array.isArray(rawBids)) {
    return null
  }
  const bids: RevealedBid[] = []
  for (const rawBid of rawBids) {
    if (typeof rawBid !== 'object' || rawBid === null) {
      return null
    }
    const record = rawBid as Record<string, unknown>
    if (
      typeof record.slotIndex !== 'number' ||
      typeof record.bidder !== 'string' ||
      typeof record.commitment !== 'string' ||
      typeof record.price !== 'string' ||
      typeof record.salt !== 'string'
    ) {
      return null
    }
    bids.push({
      slotIndex: record.slotIndex,
      bidder: record.bidder,
      commitment: record.commitment,
      price: record.price,
      salt: record.salt,
    })
  }
  return bids
}

function parseMembers(rawMembers: unknown): string[] | null {
  if (!Array.isArray(rawMembers)) {
    return null
  }
  const members: string[] = []
  for (const member of rawMembers) {
    if (typeof member !== 'string') {
      return null
    }
    members.push(member)
  }
  return members
}

export async function requestReveal(auctionId: number): Promise<Result<RevealResult, string>> {
  let response: Response
  try {
    response = await fetch(REVEAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auctionId }),
    })
  } catch (networkError) {
    return { ok: false, error: networkError instanceof Error ? networkError.message : String(networkError) }
  }

  const rawText = await response.text()
  let payload: RevealResponseBody
  try {
    payload = JSON.parse(rawText) as RevealResponseBody
  } catch {
    return { ok: false, error: `reveal returned a non-JSON response (${response.status})` }
  }

  if (response.ok && payload.ok === true) {
    if (payload.alreadySettled === true) {
      return { ok: true, value: { kind: 'already_settled' } }
    }
    const bids = parseRevealedBids(payload.bids)
    const members = parseMembers(payload.members)
    if (bids === null || members === null || typeof payload.whitelistRoot !== 'string') {
      return { ok: false, error: 'reveal returned an unexpected shape' }
    }
    return {
      ok: true,
      value: { kind: 'revealed', bids, members, whitelistRoot: payload.whitelistRoot },
    }
  }

  return { ok: false, error: payload.error?.message ?? `reveal failed (${response.status})` }
}
