// Poseidon Merkle tree over KYC whitelist member addresses. The root is the
// public commitment an auction stores on chain; the reveal rebuilds the path to
// the winner from the same members. One source for both the create-time root and
// the settle-time path, so they can never drift.
// sourceRef: circuits/test/helpers.js, contracts/whitelist-registry/src/lib.rs,
// prover/build-whitelist.js.

import { StrKey } from '@stellar/stellar-sdk'

import { getPoseidonHasher } from './crypto'
import type { Result } from './errors'

// Whitelist tree depth; must equal the circuit's merkleDepth.
// sourceRef: circuits/auction_winner.circom, circuits/test/helpers.js.
export const MERKLE_DEPTH = 10
// Leaf capacity of the tree (empty leaves are the frozen 0 marker).
export const MAX_WHITELIST_MEMBERS = 2 ** MERKLE_DEPTH

// leaf = Poseidon2(hi_128, lo_128) over the 32 raw key bytes, big-endian halves.
export function computeAddressLeaf(hash: (inputs: bigint[]) => bigint, keyBytes: Uint8Array): bigint {
  let highHalf = 0n
  let lowHalf = 0n
  for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
    highHalf = (highHalf << 8n) | BigInt(keyBytes[byteIndex])
    lowHalf = (lowHalf << 8n) | BigInt(keyBytes[byteIndex + 16])
  }
  return hash([highHalf, lowHalf])
}

export class PoseidonMerkleTree {
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

// Rebuilds the whitelist Merkle root from member addresses, the value passed to
// create_auction and registered on chain. Errors as values so the caller can
// show a distinct reason for an empty, oversized, or malformed list.
export async function computeWhitelistRoot(
  members: readonly string[],
): Promise<Result<bigint, string>> {
  if (members.length === 0) {
    return { ok: false, error: 'The whitelist needs at least one address.' }
  }
  if (members.length > MAX_WHITELIST_MEMBERS) {
    return { ok: false, error: `The whitelist can hold at most ${MAX_WHITELIST_MEMBERS} addresses.` }
  }
  const hash = await getPoseidonHasher()
  const leaves: bigint[] = []
  for (const memberAddress of members) {
    let keyBytes: Uint8Array
    try {
      keyBytes = StrKey.decodeEd25519PublicKey(memberAddress)
    } catch {
      return { ok: false, error: `${memberAddress} is not a valid Stellar address.` }
    }
    leaves.push(computeAddressLeaf(hash, keyBytes))
  }
  const tree = new PoseidonMerkleTree(hash, MERKLE_DEPTH, leaves)
  return { ok: true, value: tree.root }
}
