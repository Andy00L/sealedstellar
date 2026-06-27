// Grant the fixed test amounts of tUSDC and tBENJI to one address. The two SAC
// mints are separate transactions because a Soroban transaction carries a single
// host invocation; tUSDC mints first since it is the bidding deposit asset. If a
// leg fails the whole grant fails with that leg's error.
// sourceRef: faucet/src/chain.ts mintToken.

import {
  FAUCET_TBENJI_AMOUNT,
  FAUCET_TUSDC_AMOUNT,
  TBENJI_CONTRACT_ID,
  TUSDC_CONTRACT_ID,
} from './config'
import { mintToken } from './chain'
import type { FaucetError, Result } from './result'

export type TokenGrant = {
  symbol: string
  contractId: string
  amountBaseUnits: string
  txHash: string
}

export async function grantTestTokens(address: string): Promise<Result<TokenGrant[], FaucetError>> {
  const plannedGrants = [
    { symbol: 'tUSDC', contractId: TUSDC_CONTRACT_ID, amount: FAUCET_TUSDC_AMOUNT },
    { symbol: 'tBENJI', contractId: TBENJI_CONTRACT_ID, amount: FAUCET_TBENJI_AMOUNT },
  ]
  const grants: TokenGrant[] = []
  for (const planned of plannedGrants) {
    const minted = await mintToken(planned.contractId, address, planned.amount)
    if (!minted.ok) {
      return minted
    }
    grants.push({
      symbol: planned.symbol,
      contractId: planned.contractId,
      amountBaseUnits: planned.amount.toString(),
      txHash: minted.value.txHash,
    })
  }
  return { ok: true, value: grants }
}
