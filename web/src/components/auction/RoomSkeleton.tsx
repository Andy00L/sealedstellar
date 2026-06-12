// Room loading state: a skeleton of the final room layout.
// sourceRef: design-handoff/stellar/project/ss-unseal.jsx EdgeLoading.

import { Skeleton } from '@/components/ui/skeleton'

export function RoomSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between">
        <div className="grid gap-2">
          <Skeleton className="h-[26px] w-44" />
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="grid justify-items-end gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_unusedCell, cellIndex) => (
          <Skeleton key={cellIndex} className="h-[170px] rounded-lg" />
        ))}
      </div>
    </div>
  )
}
