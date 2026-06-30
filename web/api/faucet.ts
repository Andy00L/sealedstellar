// Vercel serverless function: the test-token faucet. Mints tBENJI + tUSDC to a
// wallet that already holds their trustlines, signed by the issuer key read from
// the SERVER-SIDE ISSUER_SECRET env var (a non-VITE_ var, so it is never shipped
// to the browser). Same origin as the app, so the frontend calls /api/faucet
// with no CORS and no separate host. TESTNET ONLY.
// sourceRef: faucet/src/* (the standalone version this replaces) and
// scripts/stage-demo-auction.sh (the mint).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'

// Hobby functions cap at 60s; two sequential testnet mints fit comfortably.
export const config = { maxDuration: 60 }

const RPC_URL = process.env.FAUCET_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
// sourceRef: web/src/config.ts KNOWN_TOKENS.
const TUSDC_CONTRACT_ID =
  process.env.TUSDC_CONTRACT_ID ?? 'CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX'
const TBENJI_CONTRACT_ID =
  process.env.TBENJI_CONTRACT_ID ?? 'CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN'
const FAUCET_TUSDC_AMOUNT = BigInt(process.env.FAUCET_TUSDC_AMOUNT ?? '500000')
const FAUCET_TBENJI_AMOUNT = BigInt(process.env.FAUCET_TBENJI_AMOUNT ?? '500000')
const COOLDOWN_MS = Number(process.env.FAUCET_COOLDOWN_MS ?? '60000')
// The mock-asset issuer; the configured secret must derive to this account.
// sourceRef: docs/MOCKS.md.
const EXPECTED_ISSUER = 'GDYLKSRXQZ7Y2Y44HDKVXB74WSXFRZRMGHKGG5XXO7ZFOWU7HWVYRR3G'

const BASE_FEE_STROOPS = '100'
const TX_TIMEOUT_SECONDS = 60
const CONFIRM_POLL_MS = 1000
// ~12s per mint; testnet confirms in roughly one ledger (~5s).
const CONFIRM_POLL_LIMIT = 12

const rpcServer = new rpc.Server(RPC_URL)

// Per-address cooldown, best-effort: serverless instances do not share memory, so
// this resets on a cold start. Acceptable for testnet mock tokens. Unit: epoch ms.
const lastGrantMsByAddress = new Map<string, number>()

type GrantError =
  | { kind: 'bad_request'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'no_trustline'; message: string }
  | { kind: 'mint_failed'; message: string }
  | { kind: 'server_misconfigured'; message: string }

function statusForError(kind: GrantError['kind']): number {
  switch (kind) {
    case 'bad_request':
      return 400
    case 'no_trustline':
      return 400
    case 'rate_limited':
      return 429
    case 'mint_failed':
      return 502
    case 'server_misconfigured':
      return 503
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Builds the issuer keypair from the server-side secret, refusing anything that is
// missing, malformed, non-testnet, or not the expected issuer.
function loadIssuer(): Keypair | GrantError {
  if (!RPC_URL.includes('testnet')) {
    return { kind: 'server_misconfigured', message: 'faucet RPC must target testnet' }
  }
  const secret = process.env.ISSUER_SECRET
  if (secret === undefined || secret.trim() === '') {
    return { kind: 'server_misconfigured', message: 'faucet is missing ISSUER_SECRET' }
  }
  let keypair: Keypair
  try {
    keypair = Keypair.fromSecret(secret.trim())
  } catch {
    return { kind: 'server_misconfigured', message: 'ISSUER_SECRET is not a valid secret seed' }
  }
  if (keypair.publicKey() !== EXPECTED_ISSUER) {
    return { kind: 'server_misconfigured', message: 'ISSUER_SECRET does not match the expected issuer' }
  }
  return keypair
}

// Reads the destination address from the request body, tolerating either a parsed
// object or a raw JSON string, without an unsafe cast.
function readAddress(body: unknown): string {
  let parsed: unknown = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return ''
    }
  }
  if (parsed === null || typeof parsed !== 'object' || !('address' in parsed)) {
    return ''
  }
  const candidate = parsed.address
  return typeof candidate === 'string' ? candidate.trim() : ''
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

async function mintToken(
  issuer: Keypair,
  contractId: string,
  toAddress: string,
  amount: bigint,
): Promise<{ txHash: string } | GrantError> {
  let issuerAccount
  try {
    issuerAccount = await rpcServer.getAccount(issuer.publicKey())
  } catch (lookupError) {
    return { kind: 'mint_failed', message: `cannot load issuer account: ${errorDetail(lookupError)}` }
  }
  const operation = new Contract(contractId).call(
    'mint',
    nativeToScVal(toAddress, { type: 'address' }),
    nativeToScVal(amount, { type: 'i128' }),
  )
  const builtTransaction = new TransactionBuilder(issuerAccount, {
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
    const detail = errorDetail(prepareError)
    if (detail.toLowerCase().includes('trustline')) {
      return { kind: 'no_trustline', message: 'destination has no trustline for the asset' }
    }
    return { kind: 'mint_failed', message: detail }
  }
  preparedTransaction.sign(issuer)

  let sendResponse
  try {
    sendResponse = await rpcServer.sendTransaction(preparedTransaction)
  } catch (sendError) {
    return { kind: 'mint_failed', message: errorDetail(sendError) }
  }
  if (sendResponse.status === 'ERROR') {
    return { kind: 'mint_failed', message: 'the network rejected the mint' }
  }

  for (let pollIndex = 0; pollIndex < CONFIRM_POLL_LIMIT; pollIndex += 1) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS))
    const status = await fetchTransactionStatus(sendResponse.hash)
    if (status === 'SUCCESS') {
      return { txHash: sendResponse.hash }
    }
    if (status === 'FAILED') {
      return { kind: 'mint_failed', message: 'the mint failed on chain' }
    }
  }
  return { kind: 'mint_failed', message: 'mint confirmation timed out' }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { kind: 'bad_request', message: 'POST only' } })
    return
  }

  const issuer = loadIssuer()
  if (!(issuer instanceof Keypair)) {
    res.status(statusForError(issuer.kind)).json({ error: issuer })
    return
  }

  const body: unknown = req.body
  const address = readAddress(body)
  if (!StrKey.isValidEd25519PublicKey(address)) {
    res.status(400).json({ error: { kind: 'bad_request', message: 'address must be a valid Stellar account (G...)' } })
    return
  }

  const lastMs = lastGrantMsByAddress.get(address)
  if (lastMs !== undefined && Date.now() - lastMs < COOLDOWN_MS) {
    const waitSeconds = Math.ceil((COOLDOWN_MS - (Date.now() - lastMs)) / 1000)
    res.status(429).json({ error: { kind: 'rate_limited', message: `already funded; wait ${waitSeconds}s before requesting again` } })
    return
  }

  const plannedGrants = [
    { symbol: 'tUSDC', contractId: TUSDC_CONTRACT_ID, amount: FAUCET_TUSDC_AMOUNT },
    { symbol: 'tBENJI', contractId: TBENJI_CONTRACT_ID, amount: FAUCET_TBENJI_AMOUNT },
  ]
  const grants: { symbol: string; contractId: string; amountBaseUnits: string; txHash: string }[] = []
  for (const planned of plannedGrants) {
    const minted = await mintToken(issuer, planned.contractId, address, planned.amount)
    if ('kind' in minted) {
      res.status(statusForError(minted.kind)).json({ error: minted })
      return
    }
    grants.push({
      symbol: planned.symbol,
      contractId: planned.contractId,
      amountBaseUnits: planned.amount.toString(),
      txHash: minted.txHash,
    })
  }

  lastGrantMsByAddress.set(address, Date.now())
  res.status(200).json({ ok: true, address, grants })
}
