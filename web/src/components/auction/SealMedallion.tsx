// The frosted seal medallion: the brand object after the redesign. The
// literal wax blob is replaced by a frosted disc carrying a faint oxblood
// tint and the four-point star, so the seal survives the glass move.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html (the .seal-medallion recipe lives in index.css).

import { cn } from '@/lib/utils'

type SealMedallionProps = {
  size?: number
  className?: string
}

// U+2726 four-pointed star, the seal glyph used across the redesign.
const SEAL_GLYPH = '✦'

export function SealMedallion({ size = 54, className }: SealMedallionProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('seal-medallion grid place-items-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <span style={{ fontSize: Math.round(size * 0.4), lineHeight: 1 }}>{SEAL_GLYPH}</span>
    </span>
  )
}
