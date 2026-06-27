// Faucet entrypoint: config is validated at import (testnet guard) and crashes
// early on a bad value, then the API starts. The faucet mints through the stellar
// CLI, so this process holds no secret. Testnet only.

import { serve } from '@hono/node-server'

import { ISSUER_ALIAS, NETWORK, PORT, TBENJI_CONTRACT_ID, TUSDC_CONTRACT_ID } from './config'
import { createApi } from './api'

function log(message: string): void {
  console.log(`[main] ${message}`)
}

const app = createApi()

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log(`faucet listening on http://localhost:${info.port}`)
  log(
    `mints tUSDC ${TUSDC_CONTRACT_ID.slice(0, 8)}... and tBENJI ${TBENJI_CONTRACT_ID.slice(0, 8)}... ` +
      `as alias "${ISSUER_ALIAS}" on ${NETWORK} via the stellar CLI`,
  )
})
