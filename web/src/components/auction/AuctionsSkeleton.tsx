// Loading state: a skeleton of the glass card grid, never a spinner page.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html list card shape.

import { Skeleton } from '@/components/ui/skeleton'

export function AuctionsSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-[repeat(auto-fill,minmax(330px,1fr))]">
      {Array.from({ length: 3 }).map((_unusedCard, cardIndex) => (
        <div key={cardIndex} className="glass-panel grid gap-5 rounded-[20px] p-5.5">
          <div className="flex items-start justify-between">
            <div className="grid gap-1.5">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex items-end justify-between border-t border-foreground/7 pt-4">
            <div className="grid gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-[18px] w-20" />
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: 8 }).map((_unusedPip, pipIndex) => (
                <Skeleton key={pipIndex} className="h-[15px] w-[11px] rounded-[3px]" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
