// Read-only chain access for the indexer: simulate the auction contract's
// get_auction and the token symbol view, and follow getEvents cursors to ingest
// the contract events. All functions return Result values; nothing throws on
// chain or network failure. This indexer NEVER signs, submits, or holds keys.
// sourceRef: web/src/lib/chain.ts (decode) and prover/fetch-bid-events.js
// (cursor-following getEvents loop).

import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'

import { AUCTION_CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from './config'
import type { ChainError, Result } from './result'
import type { AuctionStatus } from './types'

const rpcServer = new rpc.Server(RPC_URL)

// Canonical null source account for read-only simulation (never signs).
// sourceRef: web/src/lib/chain.ts SIMULATION_SOURCE_ACCOUNT.
const SIMULATION_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const SIMULATION_FEE_STROOPS = '100'
// getEvents paginates by ledger range, not by match count; walk this many pages
// before stopping. sourceRef: web/src/lib/chain.ts.
const MAX_EVENT_PAGES = 60
const EVENT_PAGE_LIMIT = 200

const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseContractErrorCode(simulationErrorText: string): number | undefined {
  const matched = CONTRACT_ERROR_PATTERN.exec(simulationErrorText)
  return matched ? Number(matched[1]) : undefined
}

async function simulateView(
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
    return { ok: false, error: { kind: 'rpc_unreachable', detail: errorDetail(networkError) } }
  }
  if (rpc.Api.isSimulationError(simulation)) {
    const code = parseContractErrorCode(simulation.error)
    if (code !== undefined) {
      return { ok: false, error: { kind: 'contract_error', code } }
    }
    return { ok: false, error: { kind: 'simulation_failed', detail: simulation.error } }
  }
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    return { ok: false, error: { kind: 'simulation_failed', detail: 'simulation returned no result' } }
  }
  return { ok: true, value: scValToNative(simulation.result.retval) }
}

export type DecodedBid = { slotIndex: number; bidder: string }

export type DecodedAuction = {
  seller: string
  rwaToken: string
  lotAmount: string
  paymentToken: string
  maxPrice: string
  commitDeadlineSeconds: number
  gracePeriodSeconds: number
  status: AuctionStatus
  bids: DecodedBid[]
  lotReclaimed: boolean
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
  bids: { bidder: string }[]
  lot_reclaimed: boolean
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

function decodeStatus(rawStatus: unknown): AuctionStatus | null {
  const statusText = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
  if (statusText === 'Open' || statusText === 'Settled' || statusText === 'Refunded') {
    return statusText
  }
  return null
}

export async function getAuction(auctionId: number): Promise<Result<DecodedAuction, ChainError>> {
  const simulated = await simulateView(AUCTION_CONTRACT_ID, 'get_auction', [
    nativeToScVal(auctionId, { type: 'u64' }),
  ])
  if (!simulated.ok) {
    return simulated
  }
  if (!isRawAuctionRecord(simulated.value)) {
    return { ok: false, error: { kind: 'decode_failed', detail: 'auction record shape mismatch' } }
  }
  const record = simulated.value
  const status = decodeStatus(record.status)
  if (status === null) {
    return { ok: false, error: { kind: 'decode_failed', detail: `unknown status: ${String(record.status)}` } }
  }
  return {
    ok: true,
    value: {
      seller: record.seller,
      rwaToken: record.rwa_token,
      lotAmount: record.lot_amount.toString(),
      paymentToken: record.payment_token,
      maxPrice: record.max_price.toString(),
      commitDeadlineSeconds: Number(record.commit_deadline),
      gracePeriodSeconds: Number(record.grace_period),
      status,
      bids: record.bids.map((bid, slotIndex) => ({ slotIndex, bidder: bid.bidder })),
      lotReclaimed: record.lot_reclaimed,
    },
  }
}

const tokenSymbolCache = new Map<string, string>()

export async function getTokenSymbol(tokenContractId: string): Promise<Result<string, ChainError>> {
  const cached = tokenSymbolCache.get(tokenContractId)
  if (cached !== undefined) {
    return { ok: true, value: cached }
  }
  const simulated = await simulateView(tokenContractId, 'symbol', [])
  if (!simulated.ok) {
    return simulated
  }
  if (typeof simulated.value !== 'string') {
    return { ok: false, error: { kind: 'decode_failed', detail: 'token symbol is not a string' } }
  }
  tokenSymbolCache.set(tokenContractId, simulated.value)
  return { ok: true, value: simulated.value }
}

export type IndexedEvent = {
  name: string
  auctionId: number
  payload: Record<string, unknown>
  txHash: string | undefined
}

function decodeScVal(rawValue: unknown): unknown {
  if (typeof rawValue === 'string') {
    return scValToNative(xdr.ScVal.fromXDR(rawValue, 'base64'))
  }
  return scValToNative(rawValue as xdr.ScVal)
}

// The contract emits topics = [event_name_symbol, auction_id] and the remaining
// fields as the data map. sourceRef: contracts/auction/src/lib.rs #[contractevent].
function toIndexedEvent(raw: { topic?: unknown[]; value: unknown; txHash?: string }): IndexedEvent | null {
  const topics = raw.topic
  if (!Array.isArray(topics) || topics.length < 2) {
    return null
  }
  const name = decodeScVal(topics[0])
  const auctionId = decodeScVal(topics[1])
  const payload = decodeScVal(raw.value)
  if (typeof name !== 'string') {
    return null
  }
  const auctionIdNumber = typeof auctionId === 'bigint' ? Number(auctionId) : Number(auctionId)
  if (!Number.isInteger(auctionIdNumber) || auctionIdNumber <= 0) {
    return null
  }
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  return {
    name,
    auctionId: auctionIdNumber,
    payload: payload as Record<string, unknown>,
    txHash: raw.txHash,
  }
}

export async function getLatestLedger(): Promise<Result<number, ChainError>> {
  try {
    const latest = await rpcServer.getLatestLedger()
    return { ok: true, value: latest.sequence }
  } catch (networkError) {
    return { ok: false, error: { kind: 'rpc_unreachable', detail: errorDetail(networkError) } }
  }
}

// Follows getEvents cursors from startLedger across empty pages until the cursor
// ends or the page bound trips. Returns the decoded events and the latest ledger
// seen, so the ingester can persist a resume point. sourceRef:
// prover/fetch-bid-events.js fetchAllEvents.
export async function fetchContractEvents(
  startLedger: number,
): Promise<Result<{ events: IndexedEvent[]; latestLedger: number }, ChainError>> {
  const collected: IndexedEvent[] = []
  let pageCursor: string | undefined
  let latestLedger = startLedger
  try {
    for (let pageIndex = 0; pageIndex < MAX_EVENT_PAGES; pageIndex += 1) {
      const response = await rpcServer.getEvents(
        pageCursor
          ? {
              filters: [{ type: 'contract', contractIds: [AUCTION_CONTRACT_ID] }],
              cursor: pageCursor,
              limit: EVENT_PAGE_LIMIT,
            }
          : {
              startLedger,
              filters: [{ type: 'contract', contractIds: [AUCTION_CONTRACT_ID] }],
              limit: EVENT_PAGE_LIMIT,
            },
      )
      latestLedger = response.latestLedger ?? latestLedger
      for (const rawEvent of response.events ?? []) {
        const indexed = toIndexedEvent(rawEvent as { topic?: unknown[]; value: unknown; txHash?: string })
        if (indexed !== null) {
          collected.push(indexed)
        }
      }
      if (!response.cursor) {
        break
      }
      pageCursor = response.cursor
    }
    return { ok: true, value: { events: collected, latestLedger } }
  } catch (networkError) {
    return { ok: false, error: { kind: 'rpc_unreachable', detail: errorDetail(networkError) } }
  }
}
