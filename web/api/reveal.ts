// Vercel serverless function: the reveal step. Given a closed auction id, it
// fetches the sealed bids from chain and decrypts them with the operator box
// secret, then returns the plaintext bids. It does NOT prove or submit: the
// Groth16 prover (snarkjs) cannot cold-start in a Vercel serverless function, so
// the browser runs the proof and the wallet signs the settle. This endpoint only
// does the one step that needs the secret (decryption), which keeps it light
// enough to load on Vercel exactly like the faucet. TESTNET ONLY.
//
// The operator box secret stays server-side (a non-VITE env var, never in the
// bundle). The decrypted bids are returned to the caller only after the bid
// window has closed, which is the point of reveal; the winning bid still never
// lands on chain (the contract stores only the clearing price).
// sourceRef: web/src/lib/operator.ts (decryptBid, the pipeline this splits),
// web/src/lib/chain.ts fetchBidEvents/getAuction, web/api/faucet.ts.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Account, Contract, TransactionBuilder, nativeToScVal, scValToNative, rpc, xdr } from '@stellar/stellar-sdk'
import nacl from 'tweetnacl'

// Fallback member list for auctions with no registry entry (the demo whitelist
// and CLI-staged auctions). sourceRef: web/src/lib/demo-whitelist.ts.
import { DEMO_WHITELIST_MEMBERS } from '../src/lib/demo-whitelist'

// --- Standing network + contract (sourceRef: web/src/config.ts) --------------
const RPC_URL = process.env.SETTLE_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const AUCTION_CONTRACT_ID =
  process.env.AUCTION_CONTRACT_ID ?? 'CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4'
// Whitelist registry: members behind a custom whitelist root. sourceRef: config.ts.
const WHITELIST_REGISTRY_CONTRACT_ID =
  process.env.WHITELIST_REGISTRY_CONTRACT_ID ?? 'CCMBTTSEHZJ2VCREYTR36QZAAHR43D24IDEHPCMXR66B6HNFCAUXNNWA'

// Frozen ciphertext layout. sourceRef: prover/make-bid.js, operator.ts.
const NONCE_BYTES = 24
const EPHEMERAL_PUB_BYTES = 32
const PRICE_BYTES = 8
const SALT_BYTES = 31
// Event topic emitted by the BidPlaced struct. sourceRef: chain.ts BID_PLACED_TOPIC.
const BID_PLACED_TOPIC = 'bid_placed'
// Lookback inside the testnet event retention window. sourceRef: chain.ts.
const EVENT_LOOKBACK_LEDGERS = 100_000
// Read simulations need a structurally valid, never-signing source account.
// sourceRef: chain.ts SIMULATION_SOURCE_ACCOUNT.
const SIMULATION_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const BASE_FEE_STROOPS = '100'

const rpcServer = new rpc.Server(RPC_URL)

type RevealError =
  | { kind: 'bad_request'; message: string }
  | { kind: 'server_misconfigured'; message: string }
  | { kind: 'not_closed'; message: string }
  | { kind: 'not_settleable'; message: string }
  | { kind: 'chain_unreachable'; message: string }
  | { kind: 'reveal_failed'; message: string }

function statusForError(kind: RevealError['kind']): number {
  switch (kind) {
    case 'bad_request':
      return 400
    case 'not_closed':
      return 409
    case 'not_settleable':
      return 409
    case 'chain_unreachable':
      return 502
    case 'reveal_failed':
      return 502
    case 'server_misconfigured':
      return 503
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The operator box secret decrypts the sealed bids; it never leaves the server.
// sourceRef: web/api/faucet.ts loadIssuer, secrets/operator-box-key.json.
function loadBoxSecret(): Uint8Array | RevealError {
  if (!RPC_URL.includes('testnet')) {
    return { kind: 'server_misconfigured', message: 'reveal RPC must target testnet' }
  }
  const operatorSecretHex = process.env.OPERATOR_BOX_SECRET
  if (operatorSecretHex === undefined || !/^[0-9a-fA-F]{64}$/.test(operatorSecretHex.trim())) {
    return { kind: 'server_misconfigured', message: 'OPERATOR_BOX_SECRET must be a 32-byte hex string' }
  }
  return hexToBytes(operatorSecretHex.trim())
}

function hexToBytes(hexText: string): Uint8Array {
  const bytes = new Uint8Array(hexText.length / 2)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    bytes[byteIndex] = Number.parseInt(hexText.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
  }
  return bytes
}

// Opens one sealed bid with the operator box secret. sourceRef: operator.ts decryptBid.
function decryptBid(
  encryptedBid: Uint8Array,
  operatorSecretKey: Uint8Array,
): { price: bigint; salt: bigint } | null {
  const minimumLength = NONCE_BYTES + EPHEMERAL_PUB_BYTES + PRICE_BYTES + SALT_BYTES
  if (encryptedBid.length < minimumLength) {
    return null
  }
  const nonce = encryptedBid.subarray(0, NONCE_BYTES)
  const ephemeralPublicKey = encryptedBid.subarray(NONCE_BYTES, NONCE_BYTES + EPHEMERAL_PUB_BYTES)
  const boxBytes = encryptedBid.subarray(NONCE_BYTES + EPHEMERAL_PUB_BYTES)
  const opened = nacl.box.open(boxBytes, nonce, ephemeralPublicKey, operatorSecretKey)
  if (!opened || opened.length !== PRICE_BYTES + SALT_BYTES) {
    return null
  }
  const view = new DataView(opened.buffer, opened.byteOffset, opened.byteLength)
  const price = view.getBigUint64(0, false)
  let salt = 0n
  for (let byteIndex = PRICE_BYTES; byteIndex < opened.length; byteIndex += 1) {
    salt = (salt << 8n) | BigInt(opened[byteIndex])
  }
  return { price, salt }
}

// --- Read-only chain access (server-side ports of chain.ts) ------------------

type AuctionState = {
  status: string
  commitDeadlineSeconds: number
  whitelistRoot: bigint
}

async function getAuctionState(auctionId: number): Promise<AuctionState | RevealError> {
  const contract = new Contract(AUCTION_CONTRACT_ID)
  const sourceAccount = new Account(SIMULATION_SOURCE_ACCOUNT, '0')
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_auction', nativeToScVal(auctionId, { type: 'u64' })))
    .setTimeout(30)
    .build()

  let simulation: rpc.Api.SimulateTransactionResponse
  try {
    simulation = await rpcServer.simulateTransaction(transaction)
  } catch (networkError) {
    return { kind: 'chain_unreachable', message: `get_auction simulate failed: ${errorDetail(networkError)}` }
  }
  if (rpc.Api.isSimulationError(simulation)) {
    return { kind: 'not_settleable', message: 'auction not found on chain' }
  }
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    return { kind: 'chain_unreachable', message: 'get_auction returned no result' }
  }
  const record = scValToNative(simulation.result.retval) as {
    status?: unknown
    commit_deadline?: bigint
    whitelist_root?: bigint
  }
  const rawStatus = record.status
  const statusText = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
  if (typeof statusText !== 'string') {
    return { kind: 'chain_unreachable', message: 'get_auction status decode failed' }
  }
  if (typeof record.commit_deadline !== 'bigint' || typeof record.whitelist_root !== 'bigint') {
    return { kind: 'chain_unreachable', message: 'get_auction record shape mismatch' }
  }
  return {
    status: statusText,
    commitDeadlineSeconds: Number(record.commit_deadline),
    whitelistRoot: record.whitelist_root,
  }
}

// Reads the member addresses registered for a whitelist root. Empty when the
// root was never registered (the caller then uses the built-in demo whitelist).
// A simple simulate, no Poseidon or prover, so it stays Vercel-safe.
// sourceRef: contracts/whitelist-registry/src/lib.rs get_members.
async function getRegistryMembers(root: bigint): Promise<string[]> {
  const contract = new Contract(WHITELIST_REGISTRY_CONTRACT_ID)
  const sourceAccount = new Account(SIMULATION_SOURCE_ACCOUNT, '0')
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_members', nativeToScVal(root, { type: 'u256' })))
    .setTimeout(30)
    .build()
  try {
    const simulation = await rpcServer.simulateTransaction(transaction)
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      return []
    }
    const decoded = scValToNative(simulation.result.retval) as unknown
    if (!Array.isArray(decoded)) {
      return []
    }
    return decoded.filter((address): address is string => typeof address === 'string')
  } catch {
    return []
  }
}

type BidEvent = { slotIndex: number; bidder: string; commitment: bigint; encryptedBid: Uint8Array }

function decodeEventScVal(rawValue: unknown): unknown {
  if (typeof rawValue === 'string') {
    return scValToNative(xdr.ScVal.fromXDR(rawValue, 'base64'))
  }
  return scValToNative(rawValue as xdr.ScVal)
}

async function fetchBidEvents(auctionId: number): Promise<BidEvent[] | RevealError> {
  let latestLedgerSequence: number
  try {
    const latestLedger = await rpcServer.getLatestLedger()
    latestLedgerSequence = latestLedger.sequence
  } catch (networkError) {
    return { kind: 'chain_unreachable', message: `getLatestLedger failed: ${errorDetail(networkError)}` }
  }
  const topicFilter = [
    nativeToScVal(BID_PLACED_TOPIC, { type: 'symbol' }).toXDR('base64'),
    nativeToScVal(BigInt(auctionId), { type: 'u64' }).toXDR('base64'),
  ]
  const matched: { value: unknown }[] = []
  try {
    let pageCursor: string | undefined
    for (let pageIndex = 0; pageIndex < 30; pageIndex += 1) {
      const eventsResponse = await rpcServer.getEvents(
        pageCursor
          ? { filters: [{ type: 'contract', contractIds: [AUCTION_CONTRACT_ID], topics: [topicFilter] }], cursor: pageCursor, limit: 200 }
          : {
              startLedger: Math.max(1, latestLedgerSequence - EVENT_LOOKBACK_LEDGERS),
              filters: [{ type: 'contract', contractIds: [AUCTION_CONTRACT_ID], topics: [topicFilter] }],
              limit: 200,
            },
      )
      matched.push(...((eventsResponse.events ?? []) as { value: unknown }[]))
      if (!eventsResponse.cursor) {
        break
      }
      pageCursor = eventsResponse.cursor
    }
  } catch (networkError) {
    return { kind: 'chain_unreachable', message: `getEvents failed: ${errorDetail(networkError)}` }
  }
  const bidEvents: BidEvent[] = []
  for (const eventRecord of matched) {
    const eventData = decodeEventScVal(eventRecord.value)
    if (typeof eventData === 'object' && eventData !== null && 'slot_index' in eventData && 'encrypted_bid' in eventData) {
      const dataRecord = eventData as { slot_index: number | bigint; bidder: string; commitment: bigint; encrypted_bid: Uint8Array }
      bidEvents.push({
        slotIndex: Number(dataRecord.slot_index),
        bidder: dataRecord.bidder,
        commitment: BigInt(dataRecord.commitment),
        encryptedBid: Uint8Array.from(dataRecord.encrypted_bid),
      })
    }
  }
  bidEvents.sort((firstBid, secondBid) => firstBid.slotIndex - secondBid.slotIndex)
  return bidEvents
}

function readAuctionId(body: unknown): number | null {
  let parsed: unknown = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (parsed === null || typeof parsed !== 'object' || !('auctionId' in parsed)) {
    return null
  }
  const candidate = (parsed as { auctionId: unknown }).auctionId
  const auctionId = Number(candidate)
  return Number.isInteger(auctionId) && auctionId > 0 ? auctionId : null
}

// The public shape the browser prover consumes. Prices, salts, and commitments
// travel as decimal strings so bigints survive JSON.
type RevealedBid = {
  slotIndex: number
  bidder: string
  commitment: string
  price: string
  salt: string
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { kind: 'bad_request', message: 'POST only' } })
    return
  }

  const boxSecret = loadBoxSecret()
  if ('kind' in boxSecret) {
    res.status(statusForError(boxSecret.kind)).json({ error: boxSecret })
    return
  }

  const auctionId = readAuctionId(req.body)
  if (auctionId === null) {
    res.status(400).json({ error: { kind: 'bad_request', message: 'auctionId must be a positive integer' } })
    return
  }

  const auctionState = await getAuctionState(auctionId)
  if ('kind' in auctionState) {
    res.status(statusForError(auctionState.kind)).json({ error: auctionState })
    return
  }
  // Already settled is a success, not an error: the caller just refreshes to reveal.
  if (auctionState.status === 'Settled') {
    res.status(200).json({ ok: true, auctionId, alreadySettled: true })
    return
  }
  if (auctionState.status !== 'Open') {
    res.status(statusForError('not_settleable')).json({
      error: { kind: 'not_settleable', message: `auction status is ${auctionState.status}; there is nothing to reveal` },
    })
    return
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (nowSeconds < auctionState.commitDeadlineSeconds) {
    res.status(statusForError('not_closed')).json({
      error: { kind: 'not_closed', message: 'the bid window has not closed yet' },
    })
    return
  }

  const bidEventsResult = await fetchBidEvents(auctionId)
  if ('kind' in bidEventsResult) {
    res.status(statusForError(bidEventsResult.kind)).json({ error: bidEventsResult })
    return
  }
  if (bidEventsResult.length === 0) {
    res.status(statusForError('not_settleable')).json({
      error: { kind: 'not_settleable', message: 'no sealed bids found on chain for this auction' },
    })
    return
  }

  const bids: RevealedBid[] = []
  for (const bidEvent of bidEventsResult) {
    const opened = decryptBid(bidEvent.encryptedBid, boxSecret)
    if (!opened) {
      res.status(statusForError('reveal_failed')).json({
        error: { kind: 'reveal_failed', message: `slot ${bidEvent.slotIndex}: could not decrypt (wrong operator key?)` },
      })
      return
    }
    bids.push({
      slotIndex: bidEvent.slotIndex,
      bidder: bidEvent.bidder,
      commitment: bidEvent.commitment.toString(),
      price: opened.price.toString(),
      salt: opened.salt.toString(),
    })
  }

  const registryMembers = await getRegistryMembers(auctionState.whitelistRoot)
  const members = registryMembers.length > 0 ? registryMembers : [...DEMO_WHITELIST_MEMBERS]

  console.log(`[reveal] auction ${auctionId}: ${bids.length} bids, ${members.length} whitelist members`)
  res.status(200).json({
    ok: true,
    auctionId,
    whitelistRoot: auctionState.whitelistRoot.toString(),
    members,
    bids,
  })
}
