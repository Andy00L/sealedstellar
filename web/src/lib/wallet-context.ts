// Wallet connection state shared through context. Lives outside the
// provider component file so component files export only components
// (react-refresh) and hooks import the context without cycles.

import { createContext } from 'react'

export type WalletState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; address: string }
  | { status: 'missing' }

export type WalletContextValue = {
  wallet: WalletState
  connectWallet: () => Promise<void>
  disconnectWallet: () => Promise<void>
  dismissMissingNotice: () => void
}

export const WalletContext = createContext<WalletContextValue | null>(null)
