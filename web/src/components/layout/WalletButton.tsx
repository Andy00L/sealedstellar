// Wallet slot in the app bar: ghost connect button, connected mono pill, or
// the Freighter-missing notice.
// sourceRef: design-handoff/stellar/project/ss-ui.jsx SSAppBar and
// ss-unseal.jsx EdgeWallet.

import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useWallet } from '@/hooks/useWallet'
import { truncateAddress } from '@/lib/format'

const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/'

export function WalletButton() {
  const { wallet, connectWallet, disconnectWallet, dismissMissingNotice } = useWallet()

  if (wallet.status === 'connected') {
    return (
      <button
        type="button"
        onClick={() => void disconnectWallet()}
        title="Disconnect wallet"
        className="font-mono cursor-pointer rounded-full border border-border bg-card px-3.5 py-1.25 text-xs hover:border-foreground/22"
      >
        {truncateAddress(wallet.address)}
      </button>
    )
  }

  if (wallet.status === 'missing') {
    return (
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span>You need the Freighter extension to bid. Watching is fine without it.</span>
        <Button variant="outline" size="sm" asChild>
          <a href={FREIGHTER_INSTALL_URL} target="_blank" rel="noreferrer">
            Get Freighter
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={dismissMissingNotice}>
          Dismiss
        </Button>
      </span>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={wallet.status === 'connecting'}
      onClick={() => void connectWallet()}
    >
      {wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
    </Button>
  )
}
