// Read-only chain access: simulation-based contract views over Soroban RPC.
// All functions return Result values; nothing here throws on chain or
// network failures.

import { Account, Contract, TransactionBuilder, nativeToScVal, scValToNative, rpc } from '@stellar/stellar-sdk'

import {
  AUCTION_CONTRACT_ID,
  MAX_BID_SLOTS,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from '../config'
import { parseContractErrorCode, type ChainError, type Result } from './errors'

// Read simulations still need a structurally valid source account; this is
// the canonical null account (it never signs anything and nothing is sent).
// sourceRef: stellar CLI --bidder flag example output (days 5-6 session).
const SIMULATION_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
// Fee field is required by the envelope even though simulations charge none.
const SIMULATION_FEE_STROOPS = '100'
// Sequential probe bound for the dense auction id space; the standing demo
// instance holds far fewer than this.
const MAX_AUCTION_PROBES = 50

const rpcServer = new rpc.Server(RPC_URL)

export type AuctionStatusName = 'Open' | 'Settled' | 'Refunded'

export type BidView = {
  bidder: string
  commitment: bigint
}

export type AuctionView = {
  id: number
  seller: string
  rwaToken: string
  lotAmount: bigint
  paymentToken: string
  maxPrice: bigint
  commitDeadlineSeconds: number
  gracePeriodSeconds: number
  status: AuctionStatusName
  bids: BidView[]
  lotSymbol: string
  paymentSymbol: string
}

// Lifecycle tone shown in the UI; Open splits on the deadline clock.
// sourceRef: design-handoff/stellar/project/ss-ui.jsx ssPillLabels.
export type AuctionTone = 'open' | 'awaiting' | 'settled' | 'refunded'

export function deriveAuctionTone(view: AuctionView, nowSeconds: number): AuctionTone {
  if (view.status === 'Settled') {
    return 'settled'
  }
  if (view.status === 'Refunded') {
    return 'refunded'
  }
  return nowSeconds < view.commitDeadlineSeconds ? 'open' : 'awaiting'
}

async function simulateContractView(
  contractId: string,
  method: string,
  methodArguments: ReturnType<typeof nativeToScVal>[],
): Promise<Result<unknown, ChainError>> {
  const contract = new Contract(contractId)
  const sourceAccount = new Account(SIMULATION_SOURCE_ACCOUNT, '0')
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: SIMULATION_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...methodArguments))
    .setTimeout(30)
    .build()

  let simulation: rpc.Api.SimulateTransactionResponse
  try {
    simulation = await rpcServer.simulateTransaction(transaction)
  } catch (networkError) {
    const detail = networkError instanceof Error ? networkError.message : String(networkError)
    return { ok: false, error: { kind: 'rpc_unreachable', detail } }
  }

  if (rpc.Api.isSimulationError(simulation)) {
    const contractErrorCode = parseContractErrorCode(simulation.error)
    if (contractErrorCode !== undefined) {
      return { ok: false, error: { kind: 'contract_error', code: contractErrorCode } }
    }
    return { ok: false, error: { kind: 'simulation_failed', detail: simulation.error } }
  }
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    return { ok: false, error: { kind: 'simulation_failed', detail: 'simulation returned no result' } }
  }
  return { ok: true, value: scValToNative(simulation.result.retval) }
}

// The contracttype unit enum decodes as ["Open"] (vec of one symbol) or a
// plain string depending on sdk version; accept both, reject anything else.
function decodeStatus(rawStatus: unknown): Result<AuctionStatusName, ChainError> {
  const statusText = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
  if (statusText === 'Open' || statusText === 'Settled' || statusText === 'Refunded') {
    return { ok: true, value: statusText }
  }
  return {
    ok: false,
    error: { kind: 'decode_failed', detail: `unknown auction status: ${String(statusText)}` },
  }
}

type RawAuctionRecord = {
  seller: string
  rwa_token: string
  lot_amount: bigint
  payment_token: string
  max_price: bigint
  commit_deadline: bigint
  grace_period: bigint
  status: unknown
  bids: { bidder: string; commitment: bigint }[]
}

function isRawAuctionRecord(candidate: unknown): candidate is RawAuctionRecord {
  if (typeof candidate !== 'object' || candidate === null) {
    return false
  }
  const record = candidate as Record<string, unknown>
  return (
    typeof record.seller === 'string' &&
    typeof record.rwa_token === 'string' &&
    typeof record.lot_amount === 'bigint' &&
    typeof record.payment_token === 'string' &&
    typeof record.max_price === 'bigint' &&
    typeof record.commit_deadline === 'bigint' &&
    Array.isArray(record.bids)
  )
}

// Token symbol lookups never change for a contract; cache for the session.
const tokenSymbolCache = new Map<string, string>()

async function getTokenSymbol(tokenContractId: string): Promise<Result<string, ChainError>> {
  const cachedSymbol = tokenSymbolCache.get(tokenContractId)
  if (cachedSymbol !== undefined) {
    return { ok: true, value: cachedSymbol }
  }
  const simulated = await simulateContractView(tokenContractId, 'symbol', [])
  if (!simulated.ok) {
    return simulated
  }
  if (typeof simulated.value !== 'string') {
    return { ok: false, error: { kind: 'decode_failed', detail: 'token symbol is not a string' } }
  }
  tokenSymbolCache.set(tokenContractId, simulated.value)
  return { ok: true, value: simulated.value }
}

export async function getAuction(auctionId: number): Promise<Result<AuctionView, ChainError>> {
  const simulated = await simulateContractView(AUCTION_CONTRACT_ID, 'get_auction', [
    nativeToScVal(auctionId, { type: 'u64' }),
  ])
  if (!simulated.ok) {
    return simulated
  }
  if (!isRawAuctionRecord(simulated.value)) {
    return { ok: false, error: { kind: 'decode_failed', detail: 'auction record shape mismatch' } }
  }
  const rawRecord = simulated.value
  const statusResult = decodeStatus(rawRecord.status)
  if (!statusResult.ok) {
    return statusResult
  }
  const lotSymbolResult = await getTokenSymbol(rawRecord.rwa_token)
  if (!lotSymbolResult.ok) {
    return lotSymbolResult
  }
  const paymentSymbolResult = await getTokenSymbol(rawRecord.payment_token)
  if (!paymentSymbolResult.ok) {
    return paymentSymbolResult
  }

  return {
    ok: true,
    value: {
      id: auctionId,
      seller: rawRecord.seller,
      rwaToken: rawRecord.rwa_token,
      lotAmount: rawRecord.lot_amount,
      paymentToken: rawRecord.payment_token,
      maxPrice: rawRecord.max_price,
      // Unix seconds fit in a double until far beyond any auction horizon.
      commitDeadlineSeconds: Number(rawRecord.commit_deadline),
      gracePeriodSeconds: Number(rawRecord.grace_period),
      status: statusResult.value,
      bids: rawRecord.bids.map((rawBid) => ({
        bidder: rawBid.bidder,
        commitment: rawBid.commitment,
      })),
      lotSymbol: lotSymbolResult.value,
      paymentSymbol: paymentSymbolResult.value,
    },
  }
}

// Auction ids are dense and start at 1 (the contract increments a counter on
// every create), so the list is "probe upward until AuctionNotFound".
// sourceRef: contracts/auction/src/lib.rs DataKey::NextAuctionId.
export async function listAuctions(): Promise<Result<AuctionView[], ChainError>> {
  const collected: AuctionView[] = []
  for (let auctionId = 1; auctionId <= MAX_AUCTION_PROBES; auctionId += 1) {
    const fetched = await getAuction(auctionId)
    if (fetched.ok) {
      collected.push(fetched.value)
      continue
    }
    if (fetched.error.kind === 'contract_error') {
      // First gap means the end of the id space.
      break
    }
    return fetched
  }
  return { ok: true, value: collected }
}

export function countFilledSlots(view: AuctionView): number {
  return Math.min(view.bids.length, MAX_BID_SLOTS)
}
