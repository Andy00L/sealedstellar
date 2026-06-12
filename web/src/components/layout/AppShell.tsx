// App bar plus page container: wax mark, wordmark, Testnet chip, wallet slot.
// sourceRef: design-handoff/stellar/project/ss-ui.jsx SSAppBar.

import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { WaxSeal } from '@/components/auction/WaxSeal'
import { WalletButton } from '@/components/layout/WalletButton'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2.5 border-b border-border-soft bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <Link to="/" className="inline-flex items-center gap-2">
          <WaxSeal size={18} />
          <span className="text-[14.5px] font-semibold tracking-[-0.01em] sm:text-base">
            SealedStellar
          </span>
        </Link>
        <span className="rounded-full border border-border px-2.25 py-px text-[11px] font-medium text-muted-foreground">
          Testnet
        </span>
        <span className="flex-1" />
        <WalletButton />
      </header>
      {children}
    </div>
  )
}
