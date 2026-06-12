import { useContext } from 'react'

import { WalletContext, type WalletContextValue } from '@/lib/wallet-context'

export function useWallet(): WalletContextValue {
  const contextValue = useContext(WalletContext)
  if (contextValue === null) {
    // Wiring bug, not a runtime condition: the provider wraps the app root.
    return {
      wallet: { status: 'disconnected' },
      connectWallet: async () => undefined,
      disconnectWallet: async () => undefined,
      dismissMissingNotice: () => undefined,
    }
  }
  return contextValue
}
