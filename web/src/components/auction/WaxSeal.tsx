// Wax seal disc: irregular blob, embossed lighting, lock glyph. Pure CSS per
// the hi-fi recipe; no shadcn primitive draws a wax seal, hence custom.
// sourceRef: design-handoff/stellar/project/ss-theme.css .ss-wax and
// ss-ui.jsx SSWaxSeal.

import { SealLockIcon } from '@/components/auction/SealLockIcon'

type WaxSealProps = {
  size?: number
}

export function WaxSeal({ size = 54 }: WaxSealProps) {
  return (
    <span
      aria-hidden="true"
      className="relative grid place-items-center"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 34% 28%, var(--wax-hi), var(--wax) 58%, var(--wax-lo) 100%)',
        borderRadius: '48% 52% 51% 49% / 53% 47% 54% 46%',
        boxShadow:
          'inset 0 2px 3px rgba(255, 255, 255, 0.28), inset 0 -4px 6px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(87, 28, 23, 0.30), 0 0 0 7px color-mix(in oklab, var(--wax) 6%, transparent)',
      }}
    >
      <span
        className="absolute"
        style={{
          inset: '14%',
          borderRadius: 'inherit',
          border: '1.5px solid rgba(255, 255, 255, 0.22)',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.25)',
        }}
      />
      <span className="relative" style={{ filter: 'drop-shadow(0 1px 0.5px rgba(0, 0, 0, 0.35))' }}>
        <SealLockIcon size={Math.round(size * 0.42)} color="rgba(255, 255, 255, 0.92)" />
      </span>
    </span>
  )
}
