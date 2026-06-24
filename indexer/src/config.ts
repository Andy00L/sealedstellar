// Indexer configuration. Defaults are testnet, so the service runs with no
// .env at all. Required invariants are checked at boot and crash early with a
// clear message: a misconfigured indexer must never silently index the wrong
// network or serve wrong data.

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'

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

export const RPC_URL = readString('RPC_URL', 'https://soroban-testnet.stellar.org')
export const NETWORK_PASSPHRASE = TESTNET_PASSPHRASE
export const AUCTION_CONTRACT_ID = readString(
  'AUCTION_CONTRACT_ID',
  'CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4',
)
export const PORT = readPositiveNumber('PORT', 8787)
export const DATABASE_PATH = readString('DATABASE_PATH', './data/indexer.db')
export const ALLOWED_ORIGINS = readString(
  'ALLOWED_ORIGINS',
  'http://localhost:5173,http://127.0.0.1:5173',
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '')
export const BACKFILL_MAX_ID = readPositiveNumber('BACKFILL_MAX_ID', 1000)
export const POLL_INTERVAL_MS = readPositiveNumber('POLL_INTERVAL_MS', 5000)

// TESTNET ONLY guard: refuse to start against a non-testnet RPC. The contract
// ids and the whole demo are testnet; pointing at mainnet would index the wrong
// ledger. sourceRef: web/src/config.ts ("TESTNET ONLY. Never point this app at
// another network").
if (!RPC_URL.includes('testnet')) {
  throw new Error(
    `[config] RPC_URL must be a testnet endpoint (got ${RPC_URL}); this indexer is testnet only.`,
  )
}
