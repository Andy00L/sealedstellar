// Vercel serverless function: the auto-settler. Given an auction id, it runs
// the full operator settlement server-side and submits the settle transaction,
// so the front end can settle a closed auction on view without a human
// operator. It ports the proven in-browser pipeline (web/src/lib/operator.ts):
// fetch the sealed bids from chain, decrypt with the operator box secret,
// verify each Poseidon commitment, pick the Vickrey winner and second price,
// rebuild the whitelist Merkle path, generate the Groth16 proof with snarkjs,
// pack it to the Soroban byte layout, then sign and send the settle with a
// funded settler key. The two secrets stay server-side (non-VITE env vars, so
// never in the bundle) exactly like the faucet's ISSUER_SECRET. TESTNET ONLY.
// sourceRef: web/src/lib/operator.ts, web/src/lib/transactions.ts submitSettle,
// web/src/lib/chain.ts fetchBidEvents/getAuction, web/api/faucet.ts.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  Account,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { groth16, type Groth16Proof } from 'snarkjs'
import nacl from 'tweetnacl'
import { buildPoseidon } from 'circomlibjs'

// Proving fetches a ~5.4MB zkey and runs the witness generator; 60s is the
// Hobby cap and is comfortable for this small circuit.
export const config = { maxDuration: 60 }

// --- Standing network + contract (sourceRef: web/src/config.ts) --------------
const RPC_URL = process.env.SETTLE_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const AUCTION_CONTRACT_ID =
  process.env.AUCTION_CONTRACT_ID ?? 'CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4'

// Bid slot cap baked into the circuit and contract. sourceRef: config.ts MAX_BID_SLOTS.
const MAX_BID_SLOTS = 8
// Whitelist tree depth; must equal the circuit merkleDepth. sourceRef: operator.ts.
const MERKLE_DEPTH = 10
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
const TX_TIMEOUT_SECONDS = 60
const CONFIRM_POLL_MS = 1000
// Settle is heavier than a mint (proof verification + token moves); allow more polls.
const CONFIRM_POLL_LIMIT = 40

const rpcServer = new rpc.Server(RPC_URL)

// Per-auction in-flight guard so two concurrent views do not both submit a
// settle. Best-effort only (serverless instances do not share memory); the
// on-chain status check is the real idempotency guard. Unit: epoch ms of the
// last accepted request per auction id.
const inFlightByAuction = new Map<number, number>()
const IN_FLIGHT_MS = 90_000

type SettleError =
  | { kind: 'bad_request'; message: string }
  | { kind: 'server_misconfigured'; message: string }
  | { kind: 'not_closed'; message: string }
  | { kind: 'not_settleable'; message: string }
  | { kind: 'in_progress'; message: string }
  | { kind: 'chain_unreachable'; message: string }
  | { kind: 'settle_failed'; message: string }

function statusForError(kind: SettleError['kind']): number {
  switch (kind) {
    case 'bad_request':
      return 400
    case 'not_closed':
      return 409
    case 'not_settleable':
      return 409
    case 'in_progress':
      return 429
    case 'chain_unreachable':
      return 502
    case 'settle_failed':
      return 502
    case 'server_misconfigured':
      return 503
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// --- Server-side config from env (never logged). sourceRef: faucet.ts loadIssuer.
type SettleConfig = {
  operatorSecretKey: Uint8Array
  settlerKeypair: Keypair
  whitelistMembers: string[]
}

function loadSettleConfig(): SettleConfig | SettleError {
  if (!RPC_URL.includes('testnet')) {
    return { kind: 'server_misconfigured', message: 'settle RPC must target testnet' }
  }
  const operatorSecretHex = process.env.OPERATOR_BOX_SECRET
  if (operatorSecretHex === undefined || !/^[0-9a-fA-F]{64}$/.test(operatorSecretHex.trim())) {
    return { kind: 'server_misconfigured', message: 'OPERATOR_BOX_SECRET must be a 32-byte hex string' }
  }
  const settlerSecret = process.env.SETTLER_SECRET
  if (settlerSecret === undefined || settlerSecret.trim() === '') {
    return { kind: 'server_misconfigured', message: 'settler key is missing SETTLER_SECRET' }
  }
  let settlerKeypair: Keypair
  try {
    settlerKeypair = Keypair.fromSecret(settlerSecret.trim())
  } catch {
    return { kind: 'server_misconfigured', message: 'SETTLER_SECRET is not a valid secret seed' }
  }
  const whitelistRaw = process.env.OPERATOR_WHITELIST
  if (whitelistRaw === undefined || whitelistRaw.trim() === '') {
    return { kind: 'server_misconfigured', message: 'OPERATOR_WHITELIST is missing (comma-separated G addresses)' }
  }
  const whitelistMembers = whitelistRaw
    .split(',')
    .map((memberAddress) => memberAddress.trim())
    .filter((memberAddress) => memberAddress.length > 0)
  if (whitelistMembers.length === 0) {
    return { kind: 'server_misconfigured', message: 'OPERATOR_WHITELIST has no members' }
  }
  for (const memberAddress of whitelistMembers) {
    if (!StrKey.isValidEd25519PublicKey(memberAddress)) {
      return { kind: 'server_misconfigured', message: 'OPERATOR_WHITELIST holds an invalid G address' }
    }
  }
  return {
    operatorSecretKey: hexToBytes(operatorSecretHex.trim()),
    settlerKeypair,
    whitelistMembers,
  }
}

// --- Byte helpers + proof packing (sourceRef: operator.ts, format-args.js) ---

function hexToBytes(hexText: string): Uint8Array {
  const bytes = new Uint8Array(hexText.length / 2)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    bytes[byteIndex] = Number.parseInt(hexText.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
  }
  return bytes
}

function toBigEndianHex32(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

function packG1(coordinates: string[]): Uint8Array {
  return hexToBytes(toBigEndianHex32(BigInt(coordinates[0])) + toBigEndianHex32(BigInt(coordinates[1])))
}

// Each Fp2 coordinate as be(c1) || be(c0): snarkjs emits [c0, c1], the host
// wants c1 || c0, so the limbs swap. sourceRef: format-args.js packG2.
function packG2(coordinates: string[][]): Uint8Array {
  return hexToBytes(
    toBigEndianHex32(BigInt(coordinates[0][1])) +
      toBigEndianHex32(BigInt(coordinates[0][0])) +
      toBigEndianHex32(BigInt(coordinates[1][1])) +
      toBigEndianHex32(BigInt(coordinates[1][0])),
  )
}

type ProofBytes = { a: Uint8Array; b: Uint8Array; c: Uint8Array }

function packProof(proof: Groth16Proof): ProofBytes {
  return { a: packG1(proof.pi_a), b: packG2(proof.pi_b), c: packG1(proof.pi_c) }
}

// --- Decrypt + Vickrey selection + Merkle tree (sourceRef: operator.ts) ------

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

// Winner holds the maximum price (lowest slot on ties via strict >); the public
// clearing price is the highest price among the other slots (second price).
function selectVickreyOutcome(prices: bigint[]): {
  winnerIndex: number
  winnerPrice: bigint
  clearingPrice: bigint
} {
  let winnerIndex = -1
  let winnerPrice = -1n
  prices.forEach((price, slotIndex) => {
    if (price > winnerPrice) {
      winnerPrice = price
      winnerIndex = slotIndex
    }
  })
  let clearingPrice = 0n
  prices.forEach((price, slotIndex) => {
    if (slotIndex !== winnerIndex && price > clearingPrice) {
      clearingPrice = price
    }
  })
  return { winnerIndex, winnerPrice, clearingPrice }
}

// leaf = Poseidon2(hi_128, lo_128) over the 32 raw key bytes, big-endian halves.
function computeAddressLeaf(hash: (inputs: bigint[]) => bigint, keyBytes: Uint8Array): bigint {
  let highHalf = 0n
  let lowHalf = 0n
  for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
    highHalf = (highHalf << 8n) | BigInt(keyBytes[byteIndex])
    lowHalf = (lowHalf << 8n) | BigInt(keyBytes[byteIndex + 16])
  }
  return hash([highHalf, lowHalf])
}

class PoseidonMerkleTree {
  private readonly levels: bigint[][] = []
  private readonly depth: number

  constructor(hash: (inputs: bigint[]) => bigint, depth: number, leaves: bigint[]) {
    this.depth = depth
    const capacity = 2 ** depth
    const paddedLeaves = leaves.slice()
    while (paddedLeaves.length < capacity) {
      paddedLeaves.push(0n) // empty whitelist leaves are 0 (frozen)
    }
    this.levels.push(paddedLeaves)
    for (let levelIndex = 0; levelIndex < depth; levelIndex += 1) {
      const previousLevel = this.levels[levelIndex]
      const nextLevel: bigint[] = []
      for (let pairIndex = 0; pairIndex < previousLevel.length; pairIndex += 2) {
        nextLevel.push(hash([previousLevel[pairIndex], previousLevel[pairIndex + 1]]))
      }
      this.levels.push(nextLevel)
    }
  }

  get root(): bigint {
    return this.levels[this.depth][0]
  }

  pathFor(leafIndex: number): { elements: bigint[]; indexBits: number[] } {
    const elements: bigint[] = []
    const indexBits: number[] = []
    let runningIndex = leafIndex
    for (let levelIndex = 0; levelIndex < this.depth; levelIndex += 1) {
      const siblingIndex = runningIndex % 2 === 0 ? runningIndex + 1 : runningIndex - 1
      elements.push(this.levels[levelIndex][siblingIndex])
      indexBits.push(runningIndex % 2)
      runningIndex = Math.floor(runningIndex / 2)
    }
    return { elements, indexBits }
  }
}

// --- Poseidon (circomlibjs), built once per warm instance. sourceRef: crypto.ts.
type PoseidonHasher = (inputs: bigint[]) => bigint
let poseidonHasherPromise: Promise<PoseidonHasher> | undefined

function getPoseidonHasher(): Promise<PoseidonHasher> {
  const existing = poseidonHasherPromise
  if (existing !== undefined) {
    return existing
  }
  const created = buildPoseidon().then(
    (poseidon) => (inputs: bigint[]) => poseidon.F.toObject(poseidon(inputs)),
  )
  poseidonHasherPromise = created
  return created
}

// --- Read-only chain access (server-side ports of chain.ts) ------------------

type AuctionState = {
  status: string
  commitDeadlineSeconds: number
  whitelistRoot: bigint
}

async function getAuctionState(auctionId: number): Promise<AuctionState | SettleError> {
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

type BidEvent = { slotIndex: number; bidder: string; commitment: bigint; encryptedBid: Uint8Array }

function decodeEventScVal(rawValue: unknown): unknown {
  if (typeof rawValue === 'string') {
    return scValToNative(xdr.ScVal.fromXDR(rawValue, 'base64'))
  }
  return scValToNative(rawValue as xdr.ScVal)
}

async function fetchBidEvents(auctionId: number): Promise<BidEvent[] | SettleError> {
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

// --- Settle transaction (sourceRef: transactions.ts submitSettle + buildProofScVal, faucet.ts mint).

function buildProofScVal(proof: ProofBytes): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: nativeToScVal('a', { type: 'symbol' }), val: nativeToScVal(proof.a, { type: 'bytes' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('b', { type: 'symbol' }), val: nativeToScVal(proof.b, { type: 'bytes' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('c', { type: 'symbol' }), val: nativeToScVal(proof.c, { type: 'bytes' }) }),
  ])
}

async function fetchTransactionStatus(txHash: string): Promise<string | null> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: txHash } }),
    })
    const payload = (await response.json()) as { result?: { status?: string } }
    return typeof payload.result?.status === 'string' ? payload.result.status : null
  } catch {
    return null
  }
}

type SettleTxInput = {
  settlerKeypair: Keypair
  auctionId: number
  winnerIndex: number
  winningPrice: bigint
  winnerAddress: string
  proof: ProofBytes
}

async function submitSettleTransaction(input: SettleTxInput): Promise<{ txHash: string } | SettleError> {
  const publicKey = input.settlerKeypair.publicKey()
  let settlerAccount
  try {
    settlerAccount = await rpcServer.getAccount(publicKey)
  } catch (lookupError) {
    return { kind: 'settle_failed', message: `settler account not found or unfunded: ${errorDetail(lookupError)}` }
  }
  const operation = new Contract(AUCTION_CONTRACT_ID).call(
    'settle',
    nativeToScVal(input.auctionId, { type: 'u64' }),
    nativeToScVal(input.winnerIndex, { type: 'u32' }),
    nativeToScVal(input.winningPrice, { type: 'i128' }),
    nativeToScVal(input.winnerAddress, { type: 'address' }),
    buildProofScVal(input.proof),
  )
  const built = new TransactionBuilder(settlerAccount, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build()

  let prepared
  try {
    prepared = await rpcServer.prepareTransaction(built)
  } catch (prepareError) {
    return { kind: 'settle_failed', message: `settle prepare failed: ${errorDetail(prepareError)}` }
  }
  prepared.sign(input.settlerKeypair)

  let sendResponse
  try {
    sendResponse = await rpcServer.sendTransaction(prepared)
  } catch (sendError) {
    return { kind: 'chain_unreachable', message: `sendTransaction failed: ${errorDetail(sendError)}` }
  }
  if (sendResponse.status === 'ERROR') {
    return { kind: 'settle_failed', message: 'the network rejected the settle transaction' }
  }
  for (let pollIndex = 0; pollIndex < CONFIRM_POLL_LIMIT; pollIndex += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, CONFIRM_POLL_MS))
    const status = await fetchTransactionStatus(sendResponse.hash)
    if (status === 'SUCCESS') {
      return { txHash: sendResponse.hash }
    }
    if (status === 'FAILED') {
      return { kind: 'settle_failed', message: 'the settle transaction failed on chain' }
    }
  }
  return { kind: 'settle_failed', message: 'settle confirmation timed out' }
}

// --- The pipeline: bids -> proof -> settle (sourceRef: operator.ts generateSettleBundle).

type SettleSuccess = { winnerAddress: string; winningPrice: bigint; txHash: string }

async function runSettlement(
  auctionId: number,
  auction: AuctionState,
  settleConfig: SettleConfig,
  wasmUrl: string,
  zkeyUrl: string,
): Promise<SettleSuccess | SettleError> {
  const bidEventsResult = await fetchBidEvents(auctionId)
  if ('kind' in bidEventsResult) {
    return bidEventsResult
  }
  if (bidEventsResult.length === 0) {
    return { kind: 'not_settleable', message: 'no sealed bids found on chain for this auction' }
  }

  const hash = await getPoseidonHasher()
  const auctionIdBig = BigInt(auctionId)
  const slotPrices: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotSalts: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotCommitments: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotBidders: (string | undefined)[] = Array.from({ length: MAX_BID_SLOTS }, () => undefined)
  for (const bidEvent of bidEventsResult) {
    const opened = decryptBid(bidEvent.encryptedBid, settleConfig.operatorSecretKey)
    if (!opened) {
      return { kind: 'not_settleable', message: `slot ${bidEvent.slotIndex}: could not decrypt (wrong operator key?)` }
    }
    const recomputedCommitment = hash([opened.price, opened.salt, auctionIdBig])
    if (recomputedCommitment !== bidEvent.commitment) {
      return { kind: 'not_settleable', message: `slot ${bidEvent.slotIndex}: decrypted bid does not match its on-chain commitment` }
    }
    slotPrices[bidEvent.slotIndex] = opened.price
    slotSalts[bidEvent.slotIndex] = opened.salt
    slotCommitments[bidEvent.slotIndex] = bidEvent.commitment
    slotBidders[bidEvent.slotIndex] = bidEvent.bidder
  }

  const outcome = selectVickreyOutcome(slotPrices)
  if (outcome.winnerIndex < 0 || outcome.winnerPrice <= 0n) {
    return { kind: 'not_settleable', message: 'no positive-price bid; there is nothing to settle' }
  }
  if (outcome.clearingPrice <= 0n) {
    return { kind: 'not_settleable', message: 'fewer than two positive bids; there is no second price, so it can only be refunded' }
  }
  const winnerAddress = slotBidders[outcome.winnerIndex]
  if (winnerAddress === undefined) {
    return { kind: 'settle_failed', message: 'internal error: the winning slot has no bidder' }
  }

  const memberLeaves: bigint[] = []
  let winnerMemberIndex = -1
  for (let memberIndex = 0; memberIndex < settleConfig.whitelistMembers.length; memberIndex += 1) {
    const memberAddress = settleConfig.whitelistMembers[memberIndex]
    const keyBytes = StrKey.decodeEd25519PublicKey(memberAddress)
    memberLeaves.push(computeAddressLeaf(hash, keyBytes))
    if (memberAddress === winnerAddress) {
      winnerMemberIndex = memberIndex
    }
  }
  if (winnerMemberIndex < 0) {
    return { kind: 'not_settleable', message: 'the winner is not in the configured whitelist; membership cannot be proven' }
  }
  const tree = new PoseidonMerkleTree(hash, MERKLE_DEPTH, memberLeaves)
  if (tree.root !== auction.whitelistRoot) {
    return { kind: 'not_settleable', message: 'the configured whitelist does not rebuild to this auction on-chain root' }
  }
  const winnerPath = tree.pathFor(winnerMemberIndex)

  const circuitInput = {
    auctionId: auctionIdBig.toString(),
    commitments: slotCommitments.map((commitment) => commitment.toString()),
    winnerIndex: outcome.winnerIndex.toString(),
    winningPrice: outcome.clearingPrice.toString(),
    whitelistRoot: auction.whitelistRoot.toString(),
    winnerAddrHash: memberLeaves[winnerMemberIndex].toString(),
    bidPrices: slotPrices.map((price) => price.toString()),
    bidSalts: slotSalts.map((salt) => salt.toString()),
    merklePathElements: winnerPath.elements.map((element) => element.toString()),
    merklePathIndexBits: winnerPath.indexBits.map((indexBit) => indexBit.toString()),
  }

  let proof: Groth16Proof
  try {
    // snarkjs fastfile fetches the wasm/zkey from these same-origin URLs (the
    // browser prover uses the identical static assets under /circuit).
    const proven = await groth16.fullProve(circuitInput, wasmUrl, zkeyUrl)
    proof = proven.proof
  } catch (proveError) {
    return { kind: 'settle_failed', message: `proof generation failed: ${errorDetail(proveError)}` }
  }

  const submitted = await submitSettleTransaction({
    settlerKeypair: settleConfig.settlerKeypair,
    auctionId,
    winnerIndex: outcome.winnerIndex,
    winningPrice: outcome.clearingPrice,
    winnerAddress,
    proof: packProof(proof),
  })
  if ('kind' in submitted) {
    return submitted
  }
  return { winnerAddress, winningPrice: outcome.clearingPrice, txHash: submitted.txHash }
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { kind: 'bad_request', message: 'POST only' } })
    return
  }

  const settleConfig = loadSettleConfig()
  if ('kind' in settleConfig) {
    res.status(statusForError(settleConfig.kind)).json({ error: settleConfig })
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

  // Idempotent: an already-settled auction is a success, not an error, so the
  // front end can call this on every view without special-casing.
  if (auctionState.status === 'Settled') {
    res.status(200).json({ ok: true, auctionId, alreadySettled: true })
    return
  }
  if (auctionState.status !== 'Open') {
    res.status(statusForError('not_settleable')).json({
      error: { kind: 'not_settleable', message: `auction status is ${auctionState.status}; it cannot be settled` },
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

  const lastAcceptedMs = inFlightByAuction.get(auctionId)
  if (lastAcceptedMs !== undefined && Date.now() - lastAcceptedMs < IN_FLIGHT_MS) {
    res.status(statusForError('in_progress')).json({
      error: { kind: 'in_progress', message: 'a settlement for this auction is already running; retry shortly' },
    })
    return
  }
  inFlightByAuction.set(auctionId, Date.now())

  // Same-origin static assets the browser prover already serves (copied from
  // circuits/build at prebuild). sourceRef: web/src/lib/operator.ts CIRCUIT_*_URL.
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) {
    inFlightByAuction.delete(auctionId)
    res.status(statusForError('server_misconfigured')).json({
      error: { kind: 'server_misconfigured', message: 'cannot resolve the request host for circuit assets' },
    })
    return
  }
  const originBase = `${forwardedProto}://${host}`
  const wasmUrl = `${originBase}/circuit/auction_winner.wasm`
  const zkeyUrl = `${originBase}/circuit/auction_winner.zkey`

  try {
    const result = await runSettlement(auctionId, auctionState, settleConfig, wasmUrl, zkeyUrl)
    if ('kind' in result) {
      console.error(`[settle] auction ${auctionId} not settled: ${result.kind}`)
      res.status(statusForError(result.kind)).json({ error: result })
      return
    }
    console.log(`[settle] auction ${auctionId} settled: winner ${result.winnerAddress.slice(0, 6)}..., tx ${result.txHash}`)
    res.status(200).json({
      ok: true,
      auctionId,
      winner: result.winnerAddress,
      clearingPrice: result.winningPrice.toString(),
      txHash: result.txHash,
    })
  } finally {
    inFlightByAuction.delete(auctionId)
  }
}
