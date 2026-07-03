// In-browser operator prover. The sealed bids are decrypted server-side by
// /api/reveal (the operator box secret never enters the browser); this module
// takes those revealed bids and runs the rest of the settlement in the tab:
// verify each commitment, pick the Vickrey winner and second price, rebuild the
// whitelist Merkle path, assemble the circuit input, generate the Groth16 proof
// with snarkjs, and pack it to the Soroban byte layout. Output is a SettleBundle
// that submitSettle signs and sends, so the on-chain settle path is unchanged.
// The prover runs here because snarkjs cannot cold-start in a Vercel serverless
// function; the browser runs it fine. Nothing secret is logged.
//
// This ports the operator CLI scripts to the browser:
//   circuits/test/helpers.js  -> selectVickreyOutcome, computeAddressLeaf,
//                                PoseidonMerkleTree
//   prover/build-input.js     -> input assembly in assembleAndProve
//   prover/format-args.js     -> packG1/packG2 with the G2 limb swap

import { StrKey } from '@stellar/stellar-sdk'
import { groth16, type Groth16Proof } from 'snarkjs'

import { getPoseidonHasher } from './crypto'
import type { Result } from './errors'
import type { RevealedBid } from './reveal'
import type { SettleBundle } from './transactions'
import type { AuctionView } from './chain'
import { MAX_BID_SLOTS } from '../config'

// Served from web/public/circuit (copied from circuits/build at predev/prebuild).
const CIRCUIT_WASM_URL = '/circuit/auction_winner.wasm'
const CIRCUIT_ZKEY_URL = '/circuit/auction_winner.zkey'

// Whitelist tree depth; must equal the circuit's merkleDepth.
// sourceRef: circuits/auction_winner.circom, circuits/test/helpers.js.
const MERKLE_DEPTH = 10

export type OperatorPhase = 'fetching' | 'decrypting' | 'building' | 'proving' | 'done'

// ---------------------------------------------------------------------------
// Proof packing (sourceRef: prover/format-args.js)
// ---------------------------------------------------------------------------

type ProofBytes = {
  a: Uint8Array // G1, 64 bytes
  b: Uint8Array // G2, 128 bytes
  c: Uint8Array // G1, 64 bytes
}

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
async function proveCircuit(circuitInput: Record<string, unknown>): Promise<Result<ProofBytes, string>> {
  try {
    const { proof } = await groth16.fullProve(circuitInput, CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL)
    return { ok: true, value: packProof(proof) }
  } catch (proveError) {
    const detail = proveError instanceof Error ? proveError.message : String(proveError)
    return { ok: false, error: detail }
  }
}

// ---------------------------------------------------------------------------
// Selection + whitelist (sourceRef: circuits/test/helpers.js)
// ---------------------------------------------------------------------------

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
// The pipeline: revealed bids -> proof bundle
// ---------------------------------------------------------------------------

// Bids laid out by slot index (empty slots stay zero / undefined bidder).
type SlotData = {
  prices: bigint[]
  salts: bigint[]
  commitments: bigint[]
  bidders: (string | undefined)[]
}

// Shared tail: verify commitments, pick the winner, rebuild the Merkle path, and
// prove. Used by the reveal flow; kept separate so the decryption source (server
// or, in future, elsewhere) does not duplicate the proving logic.
async function assembleAndProve(
  auction: AuctionView,
  slots: SlotData,
  whitelistMembers: readonly string[],
  onPhase: (phase: OperatorPhase, detail?: string) => void,
): Promise<Result<SettleBundle, string>> {
  const hash = await getPoseidonHasher()
  const auctionIdBig = BigInt(auction.id)

  // Each filled slot's revealed bid must match its on-chain commitment.
  for (let slotIndex = 0; slotIndex < MAX_BID_SLOTS; slotIndex += 1) {
    if (slots.bidders[slotIndex] === undefined) {
      continue
    }
    const recomputed = hash([slots.prices[slotIndex], slots.salts[slotIndex], auctionIdBig])
    if (recomputed !== slots.commitments[slotIndex]) {
      return { ok: false, error: `Slot ${slotIndex}: the revealed bid does not match its on-chain commitment.` }
    }
  }

  onPhase('building')
  const outcome = selectVickreyOutcome(slots.prices)
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
  const winnerAddress = slots.bidders[winnerIndex]
  if (winnerAddress === undefined) {
    return { ok: false, error: 'Internal error: the winning slot has no bidder.' }
  }

  const memberLeaves: bigint[] = []
  let winnerMemberIndex = -1
  for (let memberIndex = 0; memberIndex < whitelistMembers.length; memberIndex += 1) {
    const memberAddress = whitelistMembers[memberIndex]
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
    return { ok: false, error: 'The whitelist does not rebuild to the auction on-chain root.' }
  }
  const winnerPath = tree.pathFor(winnerMemberIndex)

  const circuitInput = {
    auctionId: auctionIdBig.toString(),
    commitments: slots.commitments.map((commitment) => commitment.toString()),
    winnerIndex: winnerIndex.toString(),
    winningPrice: outcome.clearingPrice.toString(),
    whitelistRoot: auction.whitelistRoot.toString(),
    winnerAddrHash: memberLeaves[winnerMemberIndex].toString(),
    bidPrices: slots.prices.map((price) => price.toString()),
    bidSalts: slots.salts.map((salt) => salt.toString()),
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

// Turns the server-decrypted bids into a signed-settle-ready bundle. The box
// secret is never needed here; decryption already happened in /api/reveal.
export async function proveSettleFromRevealedBids(
  auction: AuctionView,
  revealedBids: RevealedBid[],
  whitelistMembers: readonly string[],
  onPhase: (phase: OperatorPhase, detail?: string) => void,
): Promise<Result<SettleBundle, string>> {
  if (revealedBids.length === 0) {
    return { ok: false, error: 'No sealed bids were revealed for this auction.' }
  }
  const slots: SlotData = {
    prices: Array.from({ length: MAX_BID_SLOTS }, () => 0n),
    salts: Array.from({ length: MAX_BID_SLOTS }, () => 0n),
    commitments: Array.from({ length: MAX_BID_SLOTS }, () => 0n),
    bidders: Array.from({ length: MAX_BID_SLOTS }, () => undefined),
  }
  for (const bid of revealedBids) {
    if (bid.slotIndex < 0 || bid.slotIndex >= MAX_BID_SLOTS) {
      return { ok: false, error: `A revealed bid has an out-of-range slot (${bid.slotIndex}).` }
    }
    let price: bigint
    let salt: bigint
    let commitment: bigint
    try {
      price = BigInt(bid.price)
      salt = BigInt(bid.salt)
      commitment = BigInt(bid.commitment)
    } catch {
      return { ok: false, error: 'A revealed bid has a non-numeric field.' }
    }
    slots.prices[bid.slotIndex] = price
    slots.salts[bid.slotIndex] = salt
    slots.commitments[bid.slotIndex] = commitment
    slots.bidders[bid.slotIndex] = bid.bidder
  }
  return assembleAndProve(auction, slots, whitelistMembers, onPhase)
}
