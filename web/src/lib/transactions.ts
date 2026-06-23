// Write path: build, simulate (prepare), sign via an injected wallet signer,
// send, and confirm contract invocations. Errors travel as values. One
// generic submitter drives both place_bid and settle; each public function
// maps the generic failure to its own distinct vocabulary (BidFailure for the
// bidder, SettleFailure for the operator).

import {
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'

import { AUCTION_CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from '../config'
import { rpcServer } from './rpc'
import {
  classifyCreateAuctionContractError,
  classifyPlaceBidChainError,
  classifySettleContractError,
  isLotTransferFailure,
  parseContractErrorCode,
  type BidFailure,
  type CreateAuctionFailure,
  type Result,
  type SettleFailure,
} from './errors'

// Confirmation reads the transaction status over raw JSON-RPC. getTransaction
// decodes the full result meta, which has been the fragile path across sdk
// versions (it threw "Bad union switch: 4" on Protocol 26 at sdk 15.1); the
// status string is all the UI needs, so we read it directly and skip the meta
// decode entirely.
type RawGetTransactionPayload = {
  result?: { status?: string }
}

async function fetchTransactionStatus(txHash: string): Promise<Result<string, string>> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash: txHash },
      }),
    })
    const payload = (await response.json()) as RawGetTransactionPayload
    const statusText = payload.result?.status
    if (typeof statusText !== 'string') {
      return { ok: false, error: 'malformed getTransaction response' }
    }
    return { ok: true, value: statusText }
  } catch (fetchError) {
    return {
      ok: false,
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
    }
  }
}

// Base fee in stroops before the simulation adds resource fees.
const BASE_FEE_STROOPS = '100'
// Transaction validity window and confirmation polling bounds.
const TX_TIMEOUT_SECONDS = 60
const CONFIRM_POLL_MS = 1000
const CONFIRM_POLL_LIMIT = 30

export type WalletSigner = (transactionXdr: string) => Promise<Result<string, 'declined'>>

// Generic invocation failure; the public functions translate these into the
// per-flow vocabularies. prepare_failed carries the raw simulation detail and
// any parsed contract error code so each flow classifies it its own way.
type InvocationFailure =
  | { kind: 'account_missing'; detail: string }
  | { kind: 'rpc_unreachable' }
  | { kind: 'prepare_failed'; detail: string; contractCode: number | undefined }
  | { kind: 'wallet_declined' }
  | { kind: 'submission_failed'; detail: string }

// Build -> prepare -> sign -> send -> confirm for a single contract
// operation. The source account must exist on chain (friendbot funded).
async function submitInvocation(
  sourceAddress: string,
  operation: xdr.Operation,
  signWithWallet: WalletSigner,
  onSigned?: () => void,
): Promise<Result<{ txHash: string }, InvocationFailure>> {
  let sourceAccount
  try {
    sourceAccount = await rpcServer.getAccount(sourceAddress)
  } catch (lookupError) {
    const detail = lookupError instanceof Error ? lookupError.message : String(lookupError)
    return {
      ok: false,
      error: detail.toLowerCase().includes('not found')
        ? { kind: 'account_missing', detail }
        : { kind: 'rpc_unreachable' },
    }
  }

  const builtTransaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build()

  let preparedTransaction
  try {
    preparedTransaction = await rpcServer.prepareTransaction(builtTransaction)
  } catch (prepareError) {
    const detail = prepareError instanceof Error ? prepareError.message : String(prepareError)
    return {
      ok: false,
      error: { kind: 'prepare_failed', detail, contractCode: parseContractErrorCode(detail) },
    }
  }

  const signedResult = await signWithWallet(preparedTransaction.toXDR())
  if (!signedResult.ok) {
    return { ok: false, error: { kind: 'wallet_declined' } }
  }
  if (onSigned) {
    onSigned()
  }
  const signedTransaction = TransactionBuilder.fromXDR(signedResult.value, NETWORK_PASSPHRASE)

  let sendResponse
  try {
    sendResponse = await rpcServer.sendTransaction(signedTransaction)
  } catch {
    return { ok: false, error: { kind: 'rpc_unreachable' } }
  }
  if (sendResponse.status === 'ERROR') {
    return {
      ok: false,
      error: { kind: 'submission_failed', detail: `send status ${sendResponse.status}` },
    }
  }

  let consecutivePollFailures = 0
  for (let pollIndex = 0; pollIndex < CONFIRM_POLL_LIMIT; pollIndex += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, CONFIRM_POLL_MS))
    const statusResult = await fetchTransactionStatus(sendResponse.hash)
    if (!statusResult.ok) {
      consecutivePollFailures += 1
      if (consecutivePollFailures >= 5) {
        return {
          ok: false,
          error: {
            kind: 'submission_failed',
            detail: `confirmation polling failed: ${statusResult.error}`,
          },
        }
      }
      continue
    }
    consecutivePollFailures = 0
    if (statusResult.value === 'SUCCESS') {
      return { ok: true, value: { txHash: sendResponse.hash } }
    }
    if (statusResult.value === 'FAILED') {
      // The raw status carries no diagnostics; a retry re-simulates and
      // surfaces the precise sentence.
      return {
        ok: false,
        error: { kind: 'submission_failed', detail: 'transaction failed on chain; retry for the reason' },
      }
    }
  }
  return {
    ok: false,
    error: { kind: 'submission_failed', detail: 'confirmation timed out; check the explorer' },
  }
}

// ---------------------------------------------------------------------------
// place_bid
// ---------------------------------------------------------------------------

export type PlaceBidReceipt = {
  txHash: string
}

export async function submitPlaceBid(
  auctionId: number,
  bidderAddress: string,
  commitment: bigint,
  encryptedBid: Uint8Array,
  signWithWallet: WalletSigner,
  onSigned?: () => void,
): Promise<Result<PlaceBidReceipt, BidFailure>> {
  const operation = new Contract(AUCTION_CONTRACT_ID).call(
    'place_bid',
    nativeToScVal(auctionId, { type: 'u64' }),
    nativeToScVal(bidderAddress, { type: 'address' }),
    nativeToScVal(commitment, { type: 'u256' }),
    nativeToScVal(encryptedBid, { type: 'bytes' }),
  )
  const outcome = await submitInvocation(bidderAddress, operation, signWithWallet, onSigned)
  if (outcome.ok) {
    return { ok: true, value: { txHash: outcome.value.txHash } }
  }
  return { ok: false, error: mapInvocationToBidFailure(outcome.error) }
}

function mapInvocationToBidFailure(failure: InvocationFailure): BidFailure {
  switch (failure.kind) {
    case 'account_missing':
      return { kind: 'submission_failed', detail: 'bidder account does not exist on testnet' }
    case 'rpc_unreachable':
      return { kind: 'rpc_unreachable' }
    case 'wallet_declined':
      return { kind: 'wallet_declined' }
    case 'prepare_failed': {
      // Token-leg failures first: SAC error codes overlap numerically with the
      // auction's (the SAC InsufficientBalance is also #10), so the diagnostic
      // text markers must win before any code mapping.
      const textClassified = classifyPlaceBidChainError({
        kind: 'simulation_failed',
        detail: failure.detail,
      })
      if (textClassified.kind === 'deposit_uncovered') {
        return textClassified
      }
      if (failure.contractCode !== undefined) {
        return classifyPlaceBidChainError({ kind: 'contract_error', code: failure.contractCode })
      }
      return textClassified
    }
    case 'submission_failed':
      return { kind: 'submission_failed', detail: failure.detail }
  }
}

// ---------------------------------------------------------------------------
// create_auction (seller flow). The seller's single signed transaction also
// authorizes the lot escrow (the sub-invocation transfer into the contract),
// so no separate approval step is needed; prepareTransaction gathers the auth.
// ---------------------------------------------------------------------------

export type CreateAuctionParams = {
  sellerAddress: string
  rwaToken: string
  lotAmount: bigint
  paymentToken: string
  maxPrice: bigint
  // Unix seconds; bid window end. u64 on chain.
  commitDeadline: bigint
  // Seconds after the deadline before refund_all opens. u64 on chain.
  gracePeriod: bigint
  // Poseidon Merkle root of the KYC whitelist. U256 on chain.
  whitelistRoot: bigint
  // tweetnacl box public key bids encrypt to. BytesN<32> on chain.
  operatorEncPubkey: Uint8Array
}

export type CreateAuctionReceipt = {
  txHash: string
}

export async function submitCreateAuction(
  params: CreateAuctionParams,
  signWithWallet: WalletSigner,
  onSigned?: () => void,
): Promise<Result<CreateAuctionReceipt, CreateAuctionFailure>> {
  const operation = new Contract(AUCTION_CONTRACT_ID).call(
    'create_auction',
    nativeToScVal(params.sellerAddress, { type: 'address' }),
    nativeToScVal(params.rwaToken, { type: 'address' }),
    nativeToScVal(params.lotAmount, { type: 'i128' }),
    nativeToScVal(params.paymentToken, { type: 'address' }),
    nativeToScVal(params.maxPrice, { type: 'i128' }),
    nativeToScVal(params.commitDeadline, { type: 'u64' }),
    nativeToScVal(params.gracePeriod, { type: 'u64' }),
    nativeToScVal(params.whitelistRoot, { type: 'u256' }),
    nativeToScVal(params.operatorEncPubkey, { type: 'bytes' }),
  )
  const outcome = await submitInvocation(params.sellerAddress, operation, signWithWallet, onSigned)
  if (outcome.ok) {
    return { ok: true, value: { txHash: outcome.value.txHash } }
  }
  return { ok: false, error: mapInvocationToCreateFailure(outcome.error) }
}

function mapInvocationToCreateFailure(failure: InvocationFailure): CreateAuctionFailure {
  switch (failure.kind) {
    case 'account_missing':
      return { kind: 'submission_failed', detail: 'the seller account does not exist on testnet' }
    case 'rpc_unreachable':
      return { kind: 'rpc_unreachable' }
    case 'wallet_declined':
      return { kind: 'wallet_declined' }
    case 'prepare_failed': {
      // The lot-escrow token leg traps as diagnostic text; SAC error codes
      // overlap numerically with the auction's, so the text markers win first.
      if (isLotTransferFailure(failure.detail)) {
        return { kind: 'lot_uncovered' }
      }
      if (failure.contractCode !== undefined) {
        const mapped = classifyCreateAuctionContractError(failure.contractCode)
        if (mapped) {
          return mapped
        }
      }
      return { kind: 'submission_failed', detail: failure.detail }
    }
    case 'submission_failed':
      return { kind: 'submission_failed', detail: failure.detail }
  }
}

// ---------------------------------------------------------------------------
// settle (operator flow, real on-chain settlement from a pasted CLI proof)
// ---------------------------------------------------------------------------

// The fixed byte lengths of the VerifierProof fields (BytesN sizes).
// sourceRef: contracts/verifier/src/lib.rs Proof { a: BytesN<64>, b:
// BytesN<128>, c: BytesN<64> }.
const PROOF_G1_HEX_LENGTH = 128 // 64 bytes
const PROOF_G2_HEX_LENGTH = 256 // 128 bytes

export type SettleBundle = {
  auctionId: number
  winnerIndex: number
  winningPrice: bigint
  winnerAddress: string
  proof: { a: Uint8Array; b: Uint8Array; c: Uint8Array }
}

export type SettleReceipt = {
  txHash: string
}

function hexToBytes(hexText: string, expectedHexLength: number): Uint8Array | null {
  if (hexText.length !== expectedHexLength || !/^[0-9a-fA-F]+$/.test(hexText)) {
    return null
  }
  const bytes = new Uint8Array(hexText.length / 2)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    bytes[byteIndex] = Number.parseInt(hexText.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
  }
  return bytes
}

// Parses and validates the JSON bundle the operator pastes, produced by
// prover/build-settle-bundle.js (proof from format-args, winner/price/address
// from build-input's settle meta). Returns a clean reason string on any
// problem so the stepper can show it verbatim.
export function parseSettleBundle(
  rawText: string,
  expectedAuctionId: number,
): Result<SettleBundle, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the full bundle from build-settle-bundle.js.' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'The bundle must be a JSON object.' }
  }
  const record = parsed as Record<string, unknown>

  const bundleAuctionId = Number(record.auctionId)
  if (!Number.isInteger(bundleAuctionId)) {
    return { ok: false, error: 'The bundle is missing a numeric auctionId.' }
  }
  if (bundleAuctionId !== expectedAuctionId) {
    return {
      ok: false,
      error: `This bundle is for auction ${bundleAuctionId}, not auction ${expectedAuctionId}.`,
    }
  }

  const winnerIndex = Number(record.winnerIndex)
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0) {
    return { ok: false, error: 'The bundle has an invalid winnerIndex.' }
  }

  if (typeof record.winnerAddress !== 'string' || !StrKey.isValidEd25519PublicKey(record.winnerAddress)) {
    return { ok: false, error: 'The bundle has an invalid winnerAddress.' }
  }

  let winningPrice: bigint
  try {
    winningPrice = BigInt(String(record.winningPrice))
  } catch {
    return { ok: false, error: 'The bundle has an invalid winningPrice.' }
  }
  if (winningPrice <= 0n) {
    return { ok: false, error: 'The clearing price must be a positive integer.' }
  }

  const proofRecord = record.proof
  if (typeof proofRecord !== 'object' || proofRecord === null) {
    return { ok: false, error: 'The bundle is missing the proof object.' }
  }
  const proofFields = proofRecord as Record<string, unknown>
  const proofA = typeof proofFields.a === 'string' ? hexToBytes(proofFields.a, PROOF_G1_HEX_LENGTH) : null
  const proofB = typeof proofFields.b === 'string' ? hexToBytes(proofFields.b, PROOF_G2_HEX_LENGTH) : null
  const proofC = typeof proofFields.c === 'string' ? hexToBytes(proofFields.c, PROOF_G1_HEX_LENGTH) : null
  if (!proofA || !proofB || !proofC) {
    return {
      ok: false,
      error: 'The proof fields a/b/c must be hex strings of 128/256/128 characters.',
    }
  }

  return {
    ok: true,
    value: {
      auctionId: bundleAuctionId,
      winnerIndex,
      winningPrice,
      winnerAddress: record.winnerAddress,
      proof: { a: proofA, b: proofB, c: proofC },
    },
  }
}

// VerifierProof is a contracttype struct; its ScVal is a map with symbol keys
// a, b, c (already lexicographically ordered) holding the proof bytes.
function buildProofScVal(proof: SettleBundle['proof']): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal('a', { type: 'symbol' }),
      val: nativeToScVal(proof.a, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('b', { type: 'symbol' }),
      val: nativeToScVal(proof.b, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('c', { type: 'symbol' }),
      val: nativeToScVal(proof.c, { type: 'bytes' }),
    }),
  ])
}

export async function submitSettle(
  bundle: SettleBundle,
  settlerAddress: string,
  signWithWallet: WalletSigner,
  onSigned?: () => void,
): Promise<Result<SettleReceipt, SettleFailure>> {
  const operation = new Contract(AUCTION_CONTRACT_ID).call(
    'settle',
    nativeToScVal(bundle.auctionId, { type: 'u64' }),
    nativeToScVal(bundle.winnerIndex, { type: 'u32' }),
    nativeToScVal(bundle.winningPrice, { type: 'i128' }),
    nativeToScVal(bundle.winnerAddress, { type: 'address' }),
    buildProofScVal(bundle.proof),
  )
  const outcome = await submitInvocation(settlerAddress, operation, signWithWallet, onSigned)
  if (outcome.ok) {
    return { ok: true, value: { txHash: outcome.value.txHash } }
  }
  return { ok: false, error: mapInvocationToSettleFailure(outcome.error) }
}

function mapInvocationToSettleFailure(failure: InvocationFailure): SettleFailure {
  switch (failure.kind) {
    case 'account_missing':
      return { kind: 'submission_failed', detail: 'the settling account does not exist on testnet' }
    case 'rpc_unreachable':
      return { kind: 'rpc_unreachable' }
    case 'wallet_declined':
      return { kind: 'wallet_declined' }
    case 'prepare_failed': {
      if (failure.contractCode !== undefined) {
        const mapped = classifySettleContractError(failure.contractCode)
        if (mapped) {
          return mapped
        }
      }
      return { kind: 'submission_failed', detail: failure.detail }
    }
    case 'submission_failed':
      return { kind: 'submission_failed', detail: failure.detail }
  }
}
