// Indexer entrypoint: open the store, start the read-only API, and kick off
// ingestion (backfill then live event loop). Config is validated at import and
// crashes early on a bad value. Testnet only.

import { serve } from '@hono/node-server'

import { AUCTION_CONTRACT_ID, DATABASE_PATH, PORT, RPC_URL } from './config'
import { AuctionStore } from './store'
import { createApi } from './api'
import { startIngestion } from './ingest'

function log(message: string): void {
  console.log(`[main] ${message}`)
}

const store = new AuctionStore(DATABASE_PATH)
const app = createApi(store)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log(`API listening on http://localhost:${info.port}`)
  log(`indexing contract ${AUCTION_CONTRACT_ID} via ${RPC_URL}`)
})

void startIngestion(store)
  .then(() => log('ingestion started (backfill complete, live sync running)'))
  .catch((error: unknown) => {
    log(`ingestion failed to start: ${error instanceof Error ? error.message : String(error)}`)
  })
