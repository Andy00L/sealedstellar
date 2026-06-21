// Wallet slot in the top bar: glass connect CTA, a connected glass chip with
// a glowing dot and the mono address, or the Freighter-missing notice.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html wallet pill + connect button.

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
        className="glass-panel flex cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.25"
      >
        <span className="size-[7px] rounded-full bg-primary shadow-[0_0_8px_rgba(43,95,217,.7)]" />
        <span className="font-mono text-[13px]">{truncateAddress(wallet.address)}</span>
      </button>
    )
  }

  if (wallet.status === 'missing') {
    return (
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="hidden sm:inline">
          You need the Freighter extension to bid. Watching is fine without it.
        </span>
        <Button variant="glass" size="sm" asChild>
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
      variant="cta"
      className="rounded-xl"
      disabled={wallet.status === 'connecting'}
      onClick={() => void connectWallet()}
    >
      {wallet.status === 'connecting' ? 'Connecting…' : 'Connect Freighter'}
    </Button>
  )
}
