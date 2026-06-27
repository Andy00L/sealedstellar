/// <reference types="vite/client" />

// Deployment-time configuration injected by Vite at build. Declaring the keys
// explicitly keeps them typed as `string | undefined` (never `any`), so the
// fallbacks in config.ts are type-checked. TESTNET ONLY.
interface ImportMetaEnv {
  readonly VITE_INDEXER_BASE_URL?: string
  readonly VITE_FAUCET_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
