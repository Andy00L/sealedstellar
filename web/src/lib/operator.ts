// In-browser operator prover. Runs the whole settlement pipeline client-side:
// fetch the sealed bids from chain, decrypt them with the operator box key,
// pick the Vickrey winner and second price, rebuild the whitelist Merkle path,
// assemble the circuit input, generate the Groth16 proof with snarkjs, and
// pack it to the Soroban byte layout. Output is a SettleBundle that submitSettle
// consumes unchanged, so the on-chain settle path is identical to the
// CLI-paste route. Nothing secret is logged.
//
// This ports the operator CLI scripts to the browser:
//   prover/operator-decrypt.js  -> decryptBid
//   circuits/test/helpers.js     -> selectVickreyOutcome, computeAddressLeaf,
//                                   PoseidonMerkleTree
//   prover/build-input.js        -> input assembly in generateSettleBundle
//   prover/format-args.js        -> packG1/packG2 with the G2 limb swap

import { StrKey } from '@stellar/stellar-sdk'
import { groth16, type Groth16Proof } from 'snarkjs'
import nacl from 'tweetnacl'

import { fetchBidEvents, type AuctionView } from './chain'
import { getPoseidonHasher } from './crypto'
import type { Result } from './errors'
import type { SettleBundle } from './transactions'
import { MAX_BID_SLOTS } from '../config'

// Served from web/public/circuit (copied from circuits/build at predev/prebuild).
const CIRCUIT_WASM_URL = '/circuit/auction_winner.wasm'
const CIRCUIT_ZKEY_URL = '/circuit/auction_winner.zkey'

// Whitelist tree depth; must equal the circuit's merkleDepth.
// sourceRef: circuits/auction_winner.circom, circuits/test/helpers.js.
const MERKLE_DEPTH = 10

// Frozen ciphertext layout (sourceRef: prover/make-bid.js, operator-decrypt.js).
const NONCE_BYTES = 24
const EPHEMERAL_PUB_BYTES = 32
const PRICE_BYTES = 8
const SALT_BYTES = 31

export type ProofBytes = {
  a: Uint8Array // G1, 64 bytes
  b: Uint8Array // G2, 128 bytes
  c: Uint8Array // G1, 64 bytes
}

export type OperatorSession = {
  /** tweetnacl box secret key (32 bytes / 64 hex), client-side only. */
  secretKeyHex: string
  /** The whitelist member addresses in leaf order (root rebuilt and checked). */
  whitelist: { members: { address: string }[] }
}

export type OperatorPhase = 'fetching' | 'decrypting' | 'building' | 'proving' | 'done'

// ---------------------------------------------------------------------------
// Proof packing (sourceRef: prover/format-args.js)
// ---------------------------------------------------------------------------

function toBigEndianHex32(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

function hexToBytes(hexText: string): Uint8Array {
  const bytes = new Uint8Array(hexText.length / 2)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    bytes[byteIndex] = Number.parseInt(hexText.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
  }
  return bytes
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

function packProof(proof: Groth16Proof): ProofBytes {
  return { a: packG1(proof.pi_a), b: packG2(proof.pi_b), c: packG1(proof.pi_c) }
}

// Runs the witness generator + Groth16 prover in the browser and returns the
// Soroban-packed proof bytes. The proving key is ~5.6MB and fetched once.
export async function proveCircuit(
  circuitInput: Record<string, unknown>,
): Promise<Result<ProofBytes, string>> {
  try {
    const { proof } = await groth16.fullProve(circuitInput, CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL)
    return { ok: true, value: packProof(proof) }
  } catch (proveError) {
    const detail = proveError instanceof Error ? proveError.message : String(proveError)
    return { ok: false, error: detail }
  }
}

// ---------------------------------------------------------------------------
// Decrypt + selection + whitelist (sourceRef: operator-decrypt.js, helpers.js)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session parsing + the full pipeline
// ---------------------------------------------------------------------------

export function parseOperatorSession(rawText: string): Result<OperatorSession, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ok: false, error: 'That is not valid JSON. Load the operator session file.' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'The operator session must be a JSON object.' }
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.secretKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(record.secretKeyHex)) {
    return { ok: false, error: 'The session is missing a valid 32-byte secretKeyHex.' }
  }
  const whitelist = record.whitelist as { members?: unknown } | undefined
  if (!whitelist || !Array.isArray(whitelist.members) || whitelist.members.length === 0) {
    return { ok: false, error: 'The session is missing whitelist members.' }
  }
  const members: { address: string }[] = []
  for (const rawMember of whitelist.members) {
    const address = (rawMember as { address?: unknown }).address
    if (typeof address !== 'string') {
      return { ok: false, error: 'A whitelist member is missing an address.' }
    }
    members.push({ address })
  }
  return { ok: true, value: { secretKeyHex: record.secretKeyHex, whitelist: { members } } }
}

export async function generateSettleBundle(
  auction: AuctionView,
  session: OperatorSession,
  onPhase: (phase: OperatorPhase, detail?: string) => void,
): Promise<Result<SettleBundle, string>> {
  onPhase('fetching')
  const eventsResult = await fetchBidEvents(auction.id)
  if (!eventsResult.ok) {
    return { ok: false, error: 'Could not fetch the sealed bids from chain. Retry.' }
  }
  const bidEvents = eventsResult.value
  if (bidEvents.length === 0) {
    return { ok: false, error: 'No sealed bids found on chain for this auction.' }
  }

  const operatorSecretKey = hexToBytes(session.secretKeyHex)
  const hash = await getPoseidonHasher()
  const auctionIdBig = BigInt(auction.id)

  onPhase('decrypting', String(bidEvents.length))
  const slotPrices: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotSalts: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotCommitments: bigint[] = Array.from({ length: MAX_BID_SLOTS }, () => 0n)
  const slotBidders: (string | undefined)[] = Array.from({ length: MAX_BID_SLOTS }, () => undefined)
  for (const bidEvent of bidEvents) {
    const opened = decryptBid(bidEvent.encryptedBid, operatorSecretKey)
    if (!opened) {
      return { ok: false, error: `Slot ${bidEvent.slotIndex}: could not decrypt (wrong operator key?).` }
    }
    const recomputedCommitment = hash([opened.price, opened.salt, auctionIdBig])
    if (recomputedCommitment !== bidEvent.commitment) {
      return {
        ok: false,
        error: `Slot ${bidEvent.slotIndex}: decrypted bid does not match its on-chain commitment.`,
      }
    }
    slotPrices[bidEvent.slotIndex] = opened.price
    slotSalts[bidEvent.slotIndex] = opened.salt
    slotCommitments[bidEvent.slotIndex] = bidEvent.commitment
    slotBidders[bidEvent.slotIndex] = bidEvent.bidder
  }

  onPhase('building')
  const outcome = selectVickreyOutcome(slotPrices)
  if (outcome.winnerIndex < 0 || outcome.winnerPrice <= 0n) {
    return { ok: false, error: 'No positive-price bid; there is nothing to settle.' }
  }
  if (outcome.clearingPrice <= 0n) {
    return {
      ok: false,
      error: 'Fewer than two positive bids: there is no second price, so the auction can only be refunded.',
    }
  }
  const winnerIndex = outcome.winnerIndex
  const winnerAddress = slotBidders[winnerIndex]
  if (winnerAddress === undefined) {
    return { ok: false, error: 'Internal error: the winning slot has no bidder.' }
  }

  const memberLeaves: bigint[] = []
  let winnerMemberIndex = -1
  for (let memberIndex = 0; memberIndex < session.whitelist.members.length; memberIndex += 1) {
    const memberAddress = session.whitelist.members[memberIndex].address
    let keyBytes: Uint8Array
    try {
      keyBytes = StrKey.decodeEd25519PublicKey(memberAddress)
    } catch {
      return { ok: false, error: `Whitelist member ${memberAddress} is not a valid address.` }
    }
    memberLeaves.push(computeAddressLeaf(hash, keyBytes))
    if (memberAddress === winnerAddress) {
      winnerMemberIndex = memberIndex
    }
  }
  if (winnerMemberIndex < 0) {
    return { ok: false, error: 'The winner is not in the whitelist; membership cannot be proven.' }
  }
  const tree = new PoseidonMerkleTree(hash, MERKLE_DEPTH, memberLeaves)
  if (tree.root !== auction.whitelistRoot) {
    return {
      ok: false,
      error: 'The whitelist does not rebuild to the auction on-chain root. Wrong whitelist file?',
    }
  }
  const winnerPath = tree.pathFor(winnerMemberIndex)

  const circuitInput = {
    auctionId: auctionIdBig.toString(),
    commitments: slotCommitments.map((commitment) => commitment.toString()),
    winnerIndex: winnerIndex.toString(),
    winningPrice: outcome.clearingPrice.toString(),
    whitelistRoot: auction.whitelistRoot.toString(),
    winnerAddrHash: memberLeaves[winnerMemberIndex].toString(),
    bidPrices: slotPrices.map((price) => price.toString()),
    bidSalts: slotSalts.map((salt) => salt.toString()),
    merklePathElements: winnerPath.elements.map((element) => element.toString()),
    merklePathIndexBits: winnerPath.indexBits.map((indexBit) => indexBit.toString()),
  }

  onPhase('proving')
  const proofResult = await proveCircuit(circuitInput)
  if (!proofResult.ok) {
    return { ok: false, error: `In-browser proving failed: ${proofResult.error}` }
  }

  onPhase('done')
  return {
    ok: true,
    value: {
      auctionId: auction.id,
      winnerIndex,
      winningPrice: outcome.clearingPrice,
      winnerAddress,
      proof: proofResult.value,
    },
  }
}
