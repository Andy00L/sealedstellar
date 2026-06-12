// Network constants and standing contract instances.
// sourceRef: docs/DECISIONS.md 2026-06-13 entry "days 8-9 stage 2 DONE"
// (standing reference instances deployed for the frontend) and the plan
// section 4.3 network values verified against RPC getNetwork on 2026-06-11.
// TESTNET ONLY. Never point this app at another network.

export const NETWORK_NAME = 'testnet'
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const RPC_URL = 'https://soroban-testnet.stellar.org'
export const HORIZON_URL = 'https://horizon-testnet.stellar.org'
export const STELLAR_EXPERT_TX_BASE = 'https://stellar.expert/explorer/testnet/tx/'

// Standing Vickrey instances (docs/DECISIONS.md 2026-06-13).
export const AUCTION_CONTRACT_ID = 'CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4'
export const VERIFIER_CONTRACT_ID = 'CD7PHFDZMHHCN25FKCERAFVXQC77CQOF55YP57VU3WEVPDY7RCNH6EGO'

// Bid slot cap baked into the circuit and contract.
// sourceRef: contracts/auction/src/lib.rs MAX_BID_SLOTS
export const MAX_BID_SLOTS = 8

// Poll cadence for chain state; testnet ledgers close about every 5 seconds,
// so one poll per ledger is the natural rhythm.
export const POLL_INTERVAL_MS = 5000
