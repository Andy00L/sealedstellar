// Write path: build, simulate, sign (via an injected wallet signer), send,
// and confirm contract invocations. Errors travel as values; every stage
// failure maps to a distinct BidFailure mode for the dialog vocabulary.

import {
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'

import { AUCTION_CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from '../config'
import { parseContractErrorCode, type BidFailure, type Result } from './errors'
import { classifyPlaceBidChainError } from './errors'

const rpcServer = new rpc.Server(RPC_URL)

// Confirmation reads the transaction status over raw JSON-RPC: the sdk's
// getTransaction parses the full result meta and throws "Bad union switch:
// 4" on Protocol 26 transactions (observed against sdk 15.1 on 2026-06-13),
// while the status string is all the dialog needs.
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

export type PlaceBidReceipt = {
  txHash: string
}

export async function submitPlaceBid(
  auctionId: number,
  bidderAddress: string,
  commitment: bigint,
  encryptedBid: Uint8Array,
  signWithWallet: WalletSigner,
): Promise<Result<PlaceBidReceipt, BidFailure>> {
  // 1. Real sequence number: the bidder account must exist (friendbot).
  let bidderAccount
  try {
    bidderAccount = await rpcServer.getAccount(bidderAddress)
  } catch (lookupError) {
    const detail = lookupError instanceof Error ? lookupError.message : String(lookupError)
    return {
      ok: false,
      error: detail.toLowerCase().includes('not found')
        ? { kind: 'submission_failed', detail: 'bidder account does not exist on testnet' }
        : { kind: 'rpc_unreachable' },
    }
  }

  // 2. Build and simulate (prepare assembles the footprint and resource fee).
  const contract = new Contract(AUCTION_CONTRACT_ID)
  const builtTransaction = new TransactionBuilder(bidderAccount, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'place_bid',
        nativeToScVal(auctionId, { type: 'u64' }),
        nativeToScVal(bidderAddress, { type: 'address' }),
        nativeToScVal(commitment, { type: 'u256' }),
        nativeToScVal(encryptedBid, { type: 'bytes' }),
      ),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build()

  let preparedTransaction
  try {
    preparedTransaction = await rpcServer.prepareTransaction(builtTransaction)
  } catch (prepareError) {
    const detail = prepareError instanceof Error ? prepareError.message : String(prepareError)
    // Token-leg failures first: SAC error codes overlap numerically with the
    // auction's (the SAC's InsufficientBalance is also #10), so the
    // diagnostic text markers must win before any code mapping.
    const textClassified = classifyPlaceBidChainError({ kind: 'simulation_failed', detail })
    if (textClassified.kind === 'deposit_uncovered') {
      return { ok: false, error: textClassified }
    }
    const contractErrorCode = parseContractErrorCode(detail)
    if (contractErrorCode !== undefined) {
      return {
        ok: false,
        error: classifyPlaceBidChainError({ kind: 'contract_error', code: contractErrorCode }),
      }
    }
    return { ok: false, error: textClassified }
  }

  // 3. One wallet signature.
  const signedResult = await signWithWallet(preparedTransaction.toXDR())
  if (!signedResult.ok) {
    return { ok: false, error: { kind: 'wallet_declined' } }
  }
  const signedTransaction = TransactionBuilder.fromXDR(signedResult.value, NETWORK_PASSPHRASE)

  // 4. Send and poll to confirmation.
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
      // surfaces the precise sentence (deadline, slots, duplicate).
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
