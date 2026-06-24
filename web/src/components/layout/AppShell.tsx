// App shell after the glass redesign: a fixed ambient field, a glass left
// rail (brand + auctions nav + avatar), and a main column whose top bar
// carries the crumb, page title, an optional back control, an optional
// per-screen trailing slot (the room perspective switch), and the wallet.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html app shell.

import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { AmbientField } from '@/components/layout/AmbientField'
import { FaucetButton } from '@/components/layout/FaucetButton'
import { WalletButton } from '@/components/layout/WalletButton'
import { SealMedallion } from '@/components/auction/SealMedallion'

type AppShellProps = {
  children: ReactNode
  /** Small monospaced eyebrow above the title (for example "TESTNET"). */
  crumb?: string
  /** Page title shown in the top bar. */
  title?: string
  /** When set, the top bar shows a back control linking here. */
  backTo?: string
  /** Per-screen control rendered before the wallet (the room perspective switch). */
  trailing?: ReactNode
}

export function AppShell({ children, crumb, title, backTo, trailing }: AppShellProps) {
  return (
    <div className="relative min-h-screen">
      <AmbientField />
      <div className="relative z-[1] flex min-h-screen">
        <GlassRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar crumb={crumb} title={title} backTo={backTo} trailing={trailing} />
          {children}
        </div>
      </div>
    </div>
  )
}

function GlassRail() {
  return (
    <nav className="glass-rail hidden w-[74px] flex-none flex-col items-center gap-6.5 py-5 sm:flex">
      <Link to="/" aria-label="SealedStellar home">
        <SealMedallion size={40} />
      </Link>
      <Link
        to="/"
        aria-label="Auctions"
        title="Auctions"
        className="grid size-[42px] place-items-center rounded-[13px] border border-primary/22 bg-primary-soft text-primary shadow-[inset_0_1px_0_rgba(255,255,255,.8)]"
      >
        <GridGlyph />
      </Link>
      {/* Decorative avatar marker; the rail's bottom anchor. */}
      <span
        aria-hidden="true"
        className="mt-auto size-[34px] rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,.4),0_4px_10px_rgba(40,38,52,.18)]"
        style={{ background: 'linear-gradient(135deg,#3f72e8,#7e2d26)' }}
      />
    </nav>
  )
}

function TopBar({ crumb, title, backTo, trailing }: Omit<AppShellProps, 'children'>) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3.5">
        {backTo ? (
          <Link
            to={backTo}
            aria-label="Back to auctions"
            className="glass-panel grid size-[38px] flex-none place-items-center rounded-xl text-foreground"
          >
            <BackGlyph />
          </Link>
        ) : (
          <SealMedallion size={34} className="sm:hidden" />
        )}
        <div className="min-w-0">
          {crumb && (
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              {crumb}
            </div>
          )}
          <div className="truncate text-[22px] font-semibold tracking-[-0.02em]">
            {title ?? 'SealedStellar'}
          </div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-2.5">
        {trailing}
        <FaucetButton />
        <WalletButton />
      </div>
    </div>
  )
}

// 2x2 rounded-square grid, the auctions glyph (inline so the rail never
// depends on a specific icon-package export).
function GridGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="2.5" width="5" height="5" rx="1.4" />
      <rect x="10.5" y="2.5" width="5" height="5" rx="1.4" />
      <rect x="2.5" y="10.5" width="5" height="5" rx="1.4" />
      <rect x="10.5" y="10.5" width="5" height="5" rx="1.4" />
    </svg>
  )
}

function BackGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M10.5 3.5 5.5 8.5l5 5" />
    </svg>
  )
}
