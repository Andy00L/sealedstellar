// Empty list state: open lock in a dashed ring, explanation, refresh.
// sourceRef: design-handoff/stellar/project/ss-screens.jsx AuctionsEmptyState.

import { Button } from '@/components/ui/button'
import { SealLockIcon } from '@/components/auction/SealLockIcon'

type AuctionsEmptyStateProps = {
  onRefresh: () => void
}

export function AuctionsEmptyState({ onRefresh }: AuctionsEmptyStateProps) {
  return (
    <div className="grid justify-items-center gap-3.5 px-8 py-13 text-center">
      <span className="grid size-16 place-items-center rounded-full border-[1.5px] border-dashed border-foreground/16 text-ink-faint">
        <SealLockIcon size={26} isOpen />
      </span>
      <span className="text-[17px] font-semibold">No auctions yet</span>
      <span className="max-w-[260px] text-sm leading-[1.55] text-muted-foreground">
        Auctions are created from the operator CLI. Once one exists on this contract it will appear
        here.
      </span>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  )
}
