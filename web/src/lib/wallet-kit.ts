// Stellar Wallets Kit singleton configuration (plan section 5 days 10-12
// names the kit for Freighter connect). Module-scope init: the kit is a
// static singleton external to React, configured exactly once at import
// time. Only the Freighter module is registered and the kit's own modal is
// never opened, so every visible pixel stays on theme.

import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit'
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter'

StellarWalletsKit.init({
  modules: [new FreighterModule()],
  selectedWalletId: FREIGHTER_ID,
  network: Networks.TESTNET,
})

export const walletKit = StellarWalletsKit
