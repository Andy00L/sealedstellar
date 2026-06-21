// Auction lifecycle chip: a dot plus a short uppercase label, one tone wash
// per status, with a bright inner edge so it reads on glass.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html toneVisual().

import type { CSSProperties } from 'react'

import type { AuctionTone } from '@/lib/chain'
import { cn } from '@/lib/utils'

type ToneVisual = {
  label: string
  dot: string
  background: string
  border: string
  foreground: string
}

const TONE_VISUALS: Record<AuctionTone, ToneVisual> = {
  open: {
    label: 'Open',
    dot: '#2b5fd9',
    background: 'rgba(43,95,217,.10)',
    border: 'rgba(43,95,217,.22)',
    foreground: '#2b5fd9',
  },
  awaiting: {
    label: 'Awaiting',
    dot: '#a8a6a0',
    background: 'rgba(29,31,31,.05)',
    border: 'rgba(29,31,31,.10)',
    foreground: '#6e6e73',
  },
  settled: {
    label: 'Settled',
    dot: '#1d1d1f',
    background: 'rgba(29,31,31,.08)',
    border: 'rgba(29,31,31,.14)',
    foreground: '#1d1d1f',
  },
  refunded: {
    label: 'Refunded',
    dot: '#b8472f',
    background: 'rgba(184,71,47,.08)',
    border: 'rgba(184,71,47,.2)',
    foreground: '#b8472f',
  },
}

type StatusPillProps = {
  status: AuctionTone
  className?: string
}

export function StatusPill({ status, className }: StatusPillProps) {
  const visual = TONE_VISUALS[status]
  const pillStyle: CSSProperties = {
    background: visual.background,
    border: `1px solid ${visual.border}`,
    color: visual.foreground,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7)',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.75 whitespace-nowrap rounded-full px-3 py-1.5',
        'text-[10.5px] font-semibold uppercase tracking-[0.08em]',
        className,
      )}
      style={pillStyle}
    >
      <span className="size-1.5 rounded-full" style={{ background: visual.dot }} aria-hidden="true" />
      {visual.label}
    </span>
  )
}
