// Wallet-asset discovery for the create-auction token picker. Reads the connected
// account's classic balances from Horizon and derives each asset's Stellar Asset
// Contract id (the C... address the Soroban auction contract moves), so a seller
// can auction any token their wallet already holds, not only the two demo assets.
// It also resolves a token typed by hand (a C... contract id, or CODE:ISSUER).
// Everything is public read data; errors travel as values, never a throw.
// sourceRef: web/src/lib/faucet.ts (Horizon load + balances + 404 handling),
// web/src/config.ts (HORIZON_URL, NETWORK_PASSPHRASE, KnownToken shape).

import { Asset, Horizon, StrKey } from '@stellar/stellar-sdk'

import { HORIZON_URL, NETWORK_PASSPHRASE } from '../config'
import type { Result } from './errors'

// A token a seller can auction: the symbol to show, the SAC contract id the
// contract call needs, the classic issuer when it is a classic asset (null for a
// raw C... contract id), and a human balance string ('' when not from a balance).
export type WalletAsset = {
  symbol: string
  contractId: string
  issuer: string | null
  balanceDisplay: string
}

export type WalletAssetsError =
  | { kind: 'account_unfunded' }
  | { kind: 'horizon_unreachable' }
  | { kind: 'invalid_input'; detail: string }

const horizonServer = new Horizon.Server(HORIZON_URL)

// Same Horizon error shape faucet.ts reads to tell "no account yet" (404) apart
// from a reachability failure. sourceRef: web/src/lib/faucet.ts horizonErrorStatus.
type HorizonErrorLike = { response?: { status?: number } }
function horizonErrorStatus(error: unknown): number | undefined {
  return (error as HorizonErrorLike).response?.status
}

// A classic asset's SAC id is deterministic from (code, issuer, network). This is
// the id the Soroban auction contract escrows and pays out. sourceRef:
// stellar-sdk Asset.contractId(networkPassphrase).
function deriveClassicContractId(
  assetCode: string,
  issuerAddress: string,
): Result<string, WalletAssetsError> {
  try {
    const contractId = new Asset(assetCode, issuerAddress).contractId(NETWORK_PASSPHRASE)
    return { ok: true, value: contractId }
  } catch (derivationError) {
    const detail = derivationError instanceof Error ? derivationError.message : String(derivationError)
    return { ok: false, error: { kind: 'invalid_input', detail: `Could not derive the token contract id: ${detail}` } }
  }
}

// Horizon reports balances in whole-token units with trailing zeros ("0.1000000");
// trim them so the picker reads "0.1", never "0.1000000". Keeps "0" for an empty
// or all-zero fractional part.
function formatWalletBalance(rawBalance: string): string {
  if (!rawBalance.includes('.')) {
    return rawBalance
  }
  const trimmed = rawBalance.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed.length > 0 ? trimmed : '0'
}

// A short, readable stand-in symbol for a raw C... contract id the wallet cannot
// name (first four and last four of the StrKey).
function shortContractLabel(contractId: string): string {
  return `${contractId.slice(0, 4)}…${contractId.slice(-4)}`
}

// Reads the account's classic (issued) balances and returns them as auctionable
// tokens. Native XLM is left out on purpose: the picker is for issued tokens a
// seller would auction, and the demo assets are already offered by default. A 404
// means the account is not funded yet, surfaced distinctly.
export async function loadWalletAssets(
  address: string,
): Promise<Result<WalletAsset[], WalletAssetsError>> {
  let account: Horizon.AccountResponse
  try {
    account = await horizonServer.loadAccount(address)
  } catch (loadError) {
    if (horizonErrorStatus(loadError) === 404) {
      return { ok: false, error: { kind: 'account_unfunded' } }
    }
    return { ok: false, error: { kind: 'horizon_unreachable' } }
  }

  const walletAssets: WalletAsset[] = []
  for (const balance of account.balances) {
    if (!('asset_code' in balance) || !('asset_issuer' in balance)) {
      continue // native XLM and liquidity-pool shares carry no (code, issuer)
    }
    const derived = deriveClassicContractId(balance.asset_code, balance.asset_issuer)
    if (!derived.ok) {
      continue // skip an asset whose SAC id cannot be derived rather than fail all
    }
    walletAssets.push({
      symbol: balance.asset_code,
      contractId: derived.value,
      issuer: balance.asset_issuer,
      balanceDisplay: formatWalletBalance(balance.balance),
    })
  }
  return { ok: true, value: walletAssets }
}

// Resolves a token the seller typed by hand: either a raw C... contract id, or a
// classic asset as CODE:ISSUER. Returns a distinct message per malformed shape.
export function resolveCustomToken(rawInput: string): Result<WalletAsset, WalletAssetsError> {
  const trimmedInput = rawInput.trim()
  if (trimmedInput.length === 0) {
    return { ok: false, error: { kind: 'invalid_input', detail: 'Enter a token contract id (C...), or CODE:ISSUER.' } }
  }
  if (StrKey.isValidContract(trimmedInput)) {
    return {
      ok: true,
      value: { symbol: shortContractLabel(trimmedInput), contractId: trimmedInput, issuer: null, balanceDisplay: '' },
    }
  }
  const separatorIndex = trimmedInput.indexOf(':')
  if (separatorIndex <= 0) {
    return { ok: false, error: { kind: 'invalid_input', detail: 'Paste a C... token contract id, or CODE:ISSUER.' } }
  }
  const assetCode = trimmedInput.slice(0, separatorIndex).trim()
  const issuerAddress = trimmedInput.slice(separatorIndex + 1).trim()
  if (!/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
    return { ok: false, error: { kind: 'invalid_input', detail: 'The asset code must be 1 to 12 letters or digits.' } }
  }
  if (!StrKey.isValidEd25519PublicKey(issuerAddress)) {
    return { ok: false, error: { kind: 'invalid_input', detail: 'The issuer after the colon is not a valid account id.' } }
  }
  const derived = deriveClassicContractId(assetCode, issuerAddress)
  if (!derived.ok) {
    return derived
  }
  return { ok: true, value: { symbol: assetCode, contractId: derived.value, issuer: issuerAddress, balanceDisplay: '' } }
}

export function describeWalletAssetsError(error: WalletAssetsError): string {
  switch (error.kind) {
    case 'account_unfunded':
      return 'This wallet has no XLM yet, so it holds no tokens. Fund it first, then add a token.'
    case 'horizon_unreachable':
      return 'Could not read your wallet balances right now. Try again in a moment.'
    case 'invalid_input':
      return error.detail
  }
}
