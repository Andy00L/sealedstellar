// Empty list state: open lock in a dashed ring inside a soft glass panel.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects glass surfaces.

import { Button } from '@/components/ui/button'
import { SealLockIcon } from '@/components/auction/SealLockIcon'

type AuctionsEmptyStateProps = {
  onRefresh: () => void
}

export function AuctionsEmptyState({ onRefresh }: AuctionsEmptyStateProps) {
  return (
    <div className="glass-soft mx-auto grid max-w-md justify-items-center gap-3.5 rounded-[22px] px-8 py-14 text-center">
      <span className="grid size-16 place-items-center rounded-full border-[1.5px] border-dashed border-foreground/16 text-ink-faint">
        <SealLockIcon size={26} isOpen />
      </span>
      <span className="text-[17px] font-semibold">No auctions yet</span>
      <span className="max-w-[260px] text-sm leading-[1.55] text-muted-foreground">
        Auctions are created from the operator CLI. Once one exists on this contract it will appear
        here.
      </span>
      <Button variant="glass" size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  )
}
