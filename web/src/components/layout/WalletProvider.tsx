// Freighter connection state provider. The kit itself is configured at
// module scope in lib/wallet-kit.ts; this component only owns the React
// state around it. No reconnect persistence: connection state lives in
// memory only (standards: no browser storage).

import { useState, type ReactNode } from 'react'

import { walletKit } from '@/lib/wallet-kit'
import { WalletContext, type WalletState } from '@/lib/wallet-context'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({ status: 'disconnected' })

  const connectWallet = async () => {
    setWallet({ status: 'connecting' })
    const freighterIsAvailable = await walletKit.selectedModule.isAvailable().catch(() => false)
    if (!freighterIsAvailable) {
      setWallet({ status: 'missing' })
      return
    }
    try {
      const fetched = await walletKit.fetchAddress()
      setWallet({ status: 'connected', address: fetched.address })
    } catch {
      // The user closed or declined the Freighter prompt; back to idle.
      setWallet({ status: 'disconnected' })
    }
  }

  const disconnectWallet = async () => {
    await walletKit.disconnect().catch(() => undefined)
    setWallet({ status: 'disconnected' })
  }

  const dismissMissingNotice = () => {
    setWallet({ status: 'disconnected' })
  }

  return (
    <WalletContext.Provider
      value={{ wallet, connectWallet, disconnectWallet, dismissMissingNotice }}
    >
      {children}
    </WalletContext.Provider>
  )
}
