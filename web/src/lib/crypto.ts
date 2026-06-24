// Browser-side bid sealing: Poseidon commitment plus tweetnacl box, exactly
// the prover pipeline's layouts so the operator tooling can open browser
// bids and vice versa.
//   commitment = Poseidon3(price, salt, auctionId)
//     (sourceRef: circuits/lib/commitment.circom, docs/DECISIONS.md
//      2026-06-12 freeze)
//   ciphertext = nonce(24) || ephemeralPub(32) || box(price 8B BE || salt 31B)
//     (sourceRef: prover/make-bid.js frozen layout)
// The salt and price never leave this module except inside the returned
// material; nothing here logs.

import { buildPoseidon, type Poseidon } from 'circomlibjs'
import nacl from 'tweetnacl'

import type { Result } from './errors'

const SALT_BYTES = 31
const NONCE_BYTES = 24
const PRICE_BYTES = 8

// Poseidon wasm initialization is ~100ms; build once per session.
let poseidonInstancePromise: Promise<Poseidon> | undefined

function getPoseidon(): Promise<Poseidon> {
  if (poseidonInstancePromise === undefined) {
    poseidonInstancePromise = buildPoseidon()
  }
  return poseidonInstancePromise
}

// A synchronous Poseidon hash (field elements in, bigint out) for the operator
// pipeline, which hashes many times when rebuilding the whitelist Merkle tree.
// The wasm is initialized once per session. sourceRef: circuits/test/helpers.js
// createPoseidonHasher.
export async function getPoseidonHasher(): Promise<(inputs: bigint[]) => bigint> {
  const poseidon = await getPoseidon()
  return (inputs) => poseidon.F.toObject(poseidon(inputs))
}

export type SealedBidMaterial = {
  commitment: bigint
  encryptedBid: Uint8Array
  /** Tab-local backup only; never rendered or logged after sealing. */
  saltDecimal: string
}

export type SealBidError = { kind: 'poseidon_init_failed'; detail: string }

function bytesToBigInt(rawBytes: Uint8Array): bigint {
  let accumulated = 0n
  for (const singleByte of rawBytes) {
    accumulated = (accumulated << 8n) | BigInt(singleByte)
  }
  return accumulated
}

export async function sealBid(
  priceUnits: bigint,
  auctionId: number,
  operatorPublicKey: Uint8Array,
): Promise<Result<SealedBidMaterial, SealBidError>> {
  let poseidon: Poseidon
  try {
    poseidon = await getPoseidon()
  } catch (initError) {
    const detail = initError instanceof Error ? initError.message : String(initError)
    return { ok: false, error: { kind: 'poseidon_init_failed', detail } }
  }

  const saltBytes = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(saltBytes)
  const saltValue = bytesToBigInt(saltBytes)

  const commitment = poseidon.F.toObject(
    poseidon([priceUnits, saltValue, BigInt(auctionId)]),
  )

  const plainPayload = new Uint8Array(PRICE_BYTES + SALT_BYTES)
  new DataView(plainPayload.buffer).setBigUint64(0, priceUnits, false)
  plainPayload.set(saltBytes, PRICE_BYTES)

  const ephemeralKeyPair = nacl.box.keyPair()
  const nonce = new Uint8Array(NONCE_BYTES)
  crypto.getRandomValues(nonce)
  const boxBytes = nacl.box(plainPayload, nonce, operatorPublicKey, ephemeralKeyPair.secretKey)

  const encryptedBid = new Uint8Array(NONCE_BYTES + ephemeralKeyPair.publicKey.length + boxBytes.length)
  encryptedBid.set(nonce, 0)
  encryptedBid.set(ephemeralKeyPair.publicKey, NONCE_BYTES)
  encryptedBid.set(boxBytes, NONCE_BYTES + ephemeralKeyPair.publicKey.length)

  return {
    ok: true,
    value: { commitment, encryptedBid, saltDecimal: saltValue.toString() },
  }
}
