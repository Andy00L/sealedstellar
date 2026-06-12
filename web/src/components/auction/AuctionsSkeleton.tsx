// Loading state: a skeleton of the final list layout, never a spinner page.
// sourceRef: design-handoff/stellar/project/ss-unseal.jsx EdgeLoading recipe
// applied to the list composition.

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function AuctionsSkeleton() {
  return (
    <div className="grid gap-3.5">
      <Skeleton className="h-[19px] w-24" />
      <Card className="grid gap-4 rounded-xl border-border-soft p-6 shadow-card">
        <div className="flex items-start justify-between">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 8 }).map((_unusedTick, tickIndex) => (
            <Skeleton key={tickIndex} className="h-6.5 w-5 rounded-[6px]" />
          ))}
        </div>
        <div className="flex items-end justify-between">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-9 w-full rounded-[12px]" />
      </Card>
      <Skeleton className="mt-2 h-[13px] w-14" />
      {Array.from({ length: 2 }).map((_unusedRow, rowIndex) => (
        <Card key={rowIndex} className="flex items-center gap-4 rounded-lg border-border-soft p-4 shadow-none">
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </Card>
      ))}
    </div>
  )
}
