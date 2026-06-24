// A small faucet shortcut next to the wallet button: opens friendbot (the
// Stellar testnet faucet) so a new user can get test XLM and start using the
// app. When a wallet is connected the address is prefilled, so friendbot funds
// it in one click; otherwise it opens the faucet to fund any address. The
// address is a public key, not sensitive data. Testnet only.

import { Droplet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useWallet } from '@/hooks/useWallet'

const FRIENDBOT_BASE_URL = 'https://friendbot.stellar.org'

export function FaucetButton() {
  const { wallet } = useWallet()
  const faucetUrl =
    wallet.status === 'connected'
      ? `${FRIENDBOT_BASE_URL}/?addr=${wallet.address}`
      : FRIENDBOT_BASE_URL
  const title =
    wallet.status === 'connected'
      ? 'Fund your connected wallet with testnet XLM'
      : 'Get testnet XLM (connect your wallet first to prefill it)'

  return (
    <Button variant="glass" size="sm" className="rounded-xl" asChild>
      <a href={faucetUrl} target="_blank" rel="noreferrer" title={title}>
        <Droplet aria-hidden="true" />
        <span className="hidden sm:inline">Faucet</span>
      </a>
    </Button>
  )
}
