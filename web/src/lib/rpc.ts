// Single Soroban RPC client for the whole app: read simulations, transaction
// sends, and event scans all share one Server so there is exactly one
// connection pool and one place to point at the network.
// sourceRef: web/src/config.ts RPC_URL.

import { rpc } from '@stellar/stellar-sdk'

import { RPC_URL } from '../config'

export const rpcServer = new rpc.Server(RPC_URL)
