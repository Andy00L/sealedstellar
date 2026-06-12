// The Verified on Soroban stamp: the one and only green element in the
// product, rotated like an ink stamp. Custom because no shadcn primitive is
// a rotated stamp; everything it uses comes from theme tokens.
// sourceRef: design-handoff/stellar/project/ss-theme.css .ss-stamp and
// ss-ui.jsx SSStamp.

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type VerifiedStampProps = {
  small?: boolean
  /** Plays the 450ms pop-in (used when the settle transaction confirms). */
  pop?: boolean
  className?: string
}

export function VerifiedStamp({ small = false, pop = false, className }: VerifiedStampProps) {
  return (
    <span
      className={cn(
        'inline-flex -rotate-3 items-center font-semibold',
        'border-verified text-verified rounded-[calc(var(--radius)-4px)]',
        'bg-[color-mix(in_oklab,var(--verified)_5%,#FFFFFF)]',
        'shadow-[0_2px_10px_color-mix(in_oklab,var(--verified)_18%,transparent)]',
        small ? 'gap-1.5 border-[1.6px] px-2.75 py-1 text-xs' : 'gap-2 border-[1.8px] px-3.75 py-1.75 text-[14.5px]',
        pop && 'animate-stamp-pop',
        className,
      )}
    >
      <Check size={small ? 13 : 16} strokeWidth={3} aria-hidden="true" />
      Verified on Soroban
    </span>
  )
}
