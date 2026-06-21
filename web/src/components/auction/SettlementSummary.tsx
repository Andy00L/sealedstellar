// Settlement summary: slides in once the unseal completes. Shows the winner,
// the clearing price (the second price the winner pays), the lot delivered,
// and a link to the real settlement transaction on Stellar Expert, with the
// privacy line restated. No winning bid value is ever shown.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html settlement summary.

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { VerifiedStamp } from '@/components/auction/VerifiedStamp'
import { truncateAddress } from '@/lib/format'
import { STELLAR_EXPERT_TX_BASE } from '@/config'

type SettlementSummaryProps = {
  winnerAddress: string | null
  clearingPriceText: string
  paymentSymbol: string
  lotText: string
  txHash?: string
  onReplay: () => void
}

function SummaryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-foreground/6 bg-white/50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.8)]">
      <div className="mb-1.75 text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</div>
      <div className="font-mono text-[15px]">{children}</div>
    </div>
  )
}

export function SettlementSummary({
  winnerAddress,
  clearingPriceText,
  paymentSymbol,
  lotText,
  txHash,
  onReplay,
}: SettlementSummaryProps) {
  return (
    <div
      className="glass-panel rounded-[22px] p-6"
      style={{ animation: 'rise var(--motion-slide) var(--ease-slide) both' }}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-[17px] font-semibold">Settlement</span>
        <VerifiedStamp small />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <SummaryField label="Winner">
          {winnerAddress ? truncateAddress(winnerAddress) : '—'}
        </SummaryField>
        <SummaryField label="Clearing price">
          {clearingPriceText} <span className="text-[12px] text-muted-foreground">{paymentSymbol}</span>
        </SummaryField>
        <SummaryField label="Lot delivered">{lotText}</SummaryField>
      </div>

      {txHash && (
        <a
          href={`${STELLAR_EXPERT_TX_BASE}${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3.5 flex items-center justify-between rounded-xl border border-primary/25 bg-[linear-gradient(180deg,rgba(43,95,217,.1),rgba(43,95,217,.06))] px-4 py-3.25 shadow-[inset_0_1px_0_rgba(255,255,255,.6)]"
        >
          <span className="text-[13.5px] font-semibold text-primary">
            View settlement on Stellar Expert
          </span>
          <span className="text-primary" aria-hidden="true">
            ↗
          </span>
        </a>
      )}

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[74%] text-[12px] leading-[1.55] text-muted-foreground">
          The winning bid was never revealed, not even the winner&apos;s. The unsealed number is the{' '}
          <strong className="text-foreground">second price</strong>, what the winner pays. Other
          cards stay sealed forever.
        </p>
        <Button variant="glass" size="sm" onClick={onReplay}>
          Replay unseal
        </Button>
      </div>
    </div>
  )
}
