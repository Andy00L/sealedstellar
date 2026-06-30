// Client side of the test-token faucet: make sure the connected wallet trusts the
// demo assets (one Freighter-signed changeTrust for any missing trustline), then
// ask the faucet service to mint them. The issuer key lives only in the faucet
// service; the browser only signs its own trustline. Errors travel as values.
// TESTNET ONLY.
// sourceRef: web/src/lib/transactions.ts (WalletSigner + build/sign pattern),
// faucet/src/api.ts (the POST /faucet contract).

import { Asset, Horizon, Operation, TransactionBuilder } from '@stellar/stellar-sdk'

import {
  HORIZON_URL,
  KNOWN_TOKENS,
  NETWORK_PASSPHRASE,
  TOKEN_ISSUER_PUBLIC_KEY,
} from '../config'

// The faucet runs as a same-origin Vercel serverless function (web/api/faucet.ts),
// so this is a relative path: no separate host, no CORS. The issuer key lives only
// in that function's server-side env.
const FAUCET_ENDPOINT = '/api/faucet'
import type { Result } from './errors'
import type { WalletSigner } from './transactions'

// Base fee in stroops for the classic trustline transaction (no Soroban resource
// fee applies). sourceRef: web/src/lib/transactions.ts BASE_FEE_STROOPS.
const BASE_FEE_STROOPS = '100'
const TX_TIMEOUT_SECONDS = 60

export type TestTokenGrant = { symbol: string; amountBaseUnits: string }

export type FaucetClientError =
  | { kind: 'wallet_declined' }
  | { kind: 'account_unfunded' }
  | { kind: 'trustline_failed'; detail: string }
  | { kind: 'faucet_unreachable' }
  | { kind: 'faucet_rejected'; detail: string }

const horizonServer = new Horizon.Server(HORIZON_URL)

// The demo assets the faucet funds, expressed as classic (code, issuer) trustline
// assets. sourceRef: web/src/config.ts KNOWN_TOKENS + TOKEN_ISSUER_PUBLIC_KEY.
function demoAssets(): Asset[] {
  return KNOWN_TOKENS.map((token) => new Asset(token.symbol, TOKEN_ISSUER_PUBLIC_KEY))
}

type HorizonSubmitError = {
  response?: { status?: number; data?: { extras?: { result_codes?: unknown } } }
}

function horizonErrorStatus(error: unknown): number | undefined {
  return (error as HorizonSubmitError).response?.status
}

function describeHorizonSubmitError(error: unknown): string {
  const resultCodes = (error as HorizonSubmitError).response?.data?.extras?.result_codes
  if (resultCodes !== undefined && resultCodes !== null) {
    return JSON.stringify(resultCodes)
  }
  return error instanceof Error ? error.message : String(error)
}

// Returns the demo assets the account does not yet trust. A 404 from Horizon
// means the account has no XLM yet, surfaced distinctly so the caller can point
// the user at the XLM faucet first.
async function findMissingTrustlines(address: string): Promise<Result<Asset[], FaucetClientError>> {
  let account: Horizon.AccountResponse
  try {
    account = await horizonServer.loadAccount(address)
  } catch (loadError) {
    if (horizonErrorStatus(loadError) === 404) {
      return { ok: false, error: { kind: 'account_unfunded' } }
    }
    return { ok: false, error: { kind: 'faucet_unreachable' } }
  }
  const trustedAssetKeys = new Set(
    account.balances.flatMap((balance) =>
      'asset_code' in balance && 'asset_issuer' in balance
        ? [`${balance.asset_code}:${balance.asset_issuer}`]
        : [],
    ),
  )
  const missingAssets = demoAssets().filter(
    (asset) => !trustedAssetKeys.has(`${asset.getCode()}:${asset.getIssuer()}`),
  )
  return { ok: true, value: missingAssets }
}

// Signs and submits one classic transaction that adds a trustline for each
// missing asset. Only the wallet owner can authorize its own trustlines, so this
// is the single Freighter signature in the flow.
async function establishTrustlines(
  address: string,
  missingAssets: Asset[],
  signWithWallet: WalletSigner,
): Promise<Result<void, FaucetClientError>> {
  let account: Horizon.AccountResponse
  try {
    account = await horizonServer.loadAccount(address)
  } catch {
    return { ok: false, error: { kind: 'faucet_unreachable' } }
  }
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
  for (const asset of missingAssets) {
    builder.addOperation(Operation.changeTrust({ asset }))
  }
  const transaction = builder.setTimeout(TX_TIMEOUT_SECONDS).build()

  const signed = await signWithWallet(transaction.toXDR())
  if (!signed.ok) {
    return { ok: false, error: { kind: 'wallet_declined' } }
  }
  const signedTransaction = TransactionBuilder.fromXDR(signed.value, NETWORK_PASSPHRASE)
  try {
    await horizonServer.submitTransaction(signedTransaction)
  } catch (submitError) {
    return { ok: false, error: { kind: 'trustline_failed', detail: describeHorizonSubmitError(submitError) } }
  }
  return { ok: true, value: undefined }
}

type FaucetResponseBody = {
  ok?: boolean
  grants?: { symbol?: unknown; amountBaseUnits?: unknown }[]
  error?: { kind?: string; message?: string }
}

async function callFaucetService(address: string): Promise<Result<TestTokenGrant[], FaucetClientError>> {
  let response: Response
  try {
    response = await fetch(FAUCET_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
  } catch {
    return { ok: false, error: { kind: 'faucet_unreachable' } }
  }
  let payload: FaucetResponseBody
  try {
    payload = (await response.json()) as FaucetResponseBody
  } catch {
    return { ok: false, error: { kind: 'faucet_rejected', detail: `unexpected response (${response.status})` } }
  }
  if (!response.ok || payload.ok !== true) {
    const detail = payload.error?.message ?? `faucet returned ${response.status}`
    return { ok: false, error: { kind: 'faucet_rejected', detail } }
  }
  const grants: TestTokenGrant[] = (payload.grants ?? []).flatMap((grant) =>
    typeof grant.symbol === 'string' && typeof grant.amountBaseUnits === 'string'
      ? [{ symbol: grant.symbol, amountBaseUnits: grant.amountBaseUnits }]
      : [],
  )
  return { ok: true, value: grants }
}

// Trust (if needed), then mint. Returns the granted amounts on success.
export async function requestTestTokens(
  address: string,
  signWithWallet: WalletSigner,
): Promise<Result<TestTokenGrant[], FaucetClientError>> {
  const missingResult = await findMissingTrustlines(address)
  if (!missingResult.ok) {
    return missingResult
  }
  if (missingResult.value.length > 0) {
    const trustResult = await establishTrustlines(address, missingResult.value, signWithWallet)
    if (!trustResult.ok) {
      return trustResult
    }
  }
  return callFaucetService(address)
}

export function describeFaucetClientError(error: FaucetClientError): string {
  switch (error.kind) {
    case 'wallet_declined':
      return 'You declined the trustline signature in your wallet. No tokens were added.'
    case 'account_unfunded':
      return 'This wallet has no XLM yet. Use the XLM faucet first, then add test tokens.'
    case 'trustline_failed':
      return `Adding the trustline failed: ${error.detail}`
    case 'faucet_unreachable':
      return 'The faucet is not reachable right now. Try again in a moment.'
    case 'faucet_rejected':
      return `The faucet declined the request: ${error.detail}`
  }
}
