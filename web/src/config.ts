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

// Off-chain indexer base URL (the indexer/ service). The list reads from it for
// scalable filter / sort / pagination and falls back to direct RPC reads when it
// is unreachable. Override per deployment with VITE_INDEXER_BASE_URL (https in
// production); unset uses the local dev port. TESTNET ONLY.
export const INDEXER_BASE_URL = import.meta.env.VITE_INDEXER_BASE_URL ?? 'http://localhost:8787'

// Bid slot cap baked into the circuit and contract.
// sourceRef: contracts/auction/src/lib.rs MAX_BID_SLOTS
export const MAX_BID_SLOTS = 8

// Poll cadence for chain state; testnet ledgers close about every 5 seconds,
// so one poll per ledger is the natural rhythm.
export const POLL_INTERVAL_MS = 5000

// Standing demo operator and KYC whitelist (public values) used as defaults when
// a seller creates an auction from the UI, so that auction is settleable by the
// demo operator and gates on the demo whitelist. Every value here is public: the
// operator box PUBLIC key, the Merkle root, and (in ./lib/demo-whitelist) the member
// account ids. Only the operator box SECRET key and the settler seed stay off-app
// (server-side env in web/api/settle.ts, and the gitignored secrets/ directory).
// sourceRef: docs/DECISIONS.md (2026-06-12 operator key + whitelist entry),
// secrets/operator-box-key.json publicKeyHex, and ./lib/demo-whitelist.
export const DEMO_OPERATOR_ENC_PUBKEY_HEX =
  'e2b45dd934b5429480a66d52b2c450df53b045ce4a89945a3e4f9bb121620806'
// The whitelist root travels with its member list in one shared, dependency-free
// module so the app and the same-origin auto-settler read a single source.
export { DEMO_WHITELIST_ROOT_DECIMAL } from './lib/demo-whitelist'

// The demo Stellar Asset Contract tokens a seller can auction or accept as
// payment. sourceRef: docs/MOCKS.md (tBENJI / tUSDC SAC ids).
export type KnownToken = { symbol: string; contractId: string }
export const KNOWN_TOKENS: readonly KnownToken[] = [
  { symbol: 'tBENJI', contractId: 'CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN' },
  { symbol: 'tUSDC', contractId: 'CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX' },
]

// Issuer of the demo assets, needed client-side only to build the trustline
// (changeTrust) for tUSDC / tBENJI. Public data. sourceRef: docs/MOCKS.md.
export const TOKEN_ISSUER_PUBLIC_KEY = 'GDYLKSRXQZ7Y2Y44HDKVXB74WSXFRZRMGHKGG5XXO7ZFOWU7HWVYRR3G'
