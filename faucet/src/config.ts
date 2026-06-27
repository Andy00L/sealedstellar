// Faucet configuration. The faucet mints by invoking the stellar CLI, which
// holds the token-issuer key in its own keystore and signs from it, so THIS
// process holds no secret at all. Defaults are testnet; required invariants are
// checked at import and crash early.
// sourceRef: scripts/stage-demo-auction.sh and scripts/e2e.sh (the same CLI mint
// and the token-issuer alias), web/src/config.ts (token ids, testnet stance).

import { StrKey } from '@stellar/stellar-sdk'

const TESTNET_NETWORK = 'testnet'

function readString(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim()
}

function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`[config] ${name} must be a positive number, got: ${raw}`)
  }
  return parsed
}

function readPositiveBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  let parsed: bigint
  try {
    parsed = BigInt(raw.trim())
  } catch {
    throw new Error(`[config] ${name} must be an integer in base units, got: ${raw}`)
  }
  if (parsed <= 0n) {
    throw new Error(`[config] ${name} must be a positive integer, got: ${raw}`)
  }
  return parsed
}

function readContractId(name: string, fallback: string): string {
  const value = readString(name, fallback)
  if (!StrKey.isValidContract(value)) {
    throw new Error(`[config] ${name} must be a valid contract id (C...), got: ${value}`)
  }
  return value
}

export const PORT = readPositiveNumber('PORT', 8788)
export const ALLOWED_ORIGINS = readString(
  'ALLOWED_ORIGINS',
  'http://localhost:5173,http://127.0.0.1:5173',
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '')

// The stellar CLI binary, the network alias it targets, and the key alias that
// owns the mock assets. The CLI signs the mint from its own keystore, so the
// faucet never holds the secret. sourceRef: scripts/stage-demo-auction.sh
// ISSUER_ALIAS="token-issuer".
export const STELLAR_BIN = readString('STELLAR_BIN', 'stellar')
export const NETWORK = readString('STELLAR_NETWORK', TESTNET_NETWORK)
export const ISSUER_ALIAS = readString('ISSUER_ALIAS', 'token-issuer')

export const TUSDC_CONTRACT_ID = readContractId(
  'TUSDC_CONTRACT_ID',
  'CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX',
)
export const TBENJI_CONTRACT_ID = readContractId(
  'TBENJI_CONTRACT_ID',
  'CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN',
)
export const FAUCET_TUSDC_AMOUNT = readPositiveBigInt('FAUCET_TUSDC_AMOUNT', 500000n)
export const FAUCET_TBENJI_AMOUNT = readPositiveBigInt('FAUCET_TBENJI_AMOUNT', 500000n)
export const FAUCET_COOLDOWN_MS = readPositiveNumber('FAUCET_COOLDOWN_MS', 60000)

// TESTNET ONLY guard: the CLI must target the testnet network alias. Minting on
// mainnet would be a real-asset action. sourceRef: indexer/src/config.ts.
if (NETWORK !== TESTNET_NETWORK) {
  throw new Error(
    `[config] STELLAR_NETWORK must be "${TESTNET_NETWORK}" (got ${NETWORK}); this faucet is testnet only.`,
  )
}
