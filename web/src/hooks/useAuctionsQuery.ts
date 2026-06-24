// Reads the auctions list from the indexer with cursor pagination and caching.
// The query key carries the active filters and the connected address, so a
// filter change or a wallet connect refetches. Density is intentionally absent
// from the key (it is a render concern, not a query).

import { useInfiniteQuery } from '@tanstack/react-query'

import { buildAuctionQuery, fetchAuctionPage, type IndexerPage } from '@/lib/indexer'
import type { AuctionsListView } from '@/lib/auctions-list-view'
import { POLL_INTERVAL_MS } from '@/config'

const PAGE_LIMIT = 24

export function useAuctionsQuery(view: AuctionsListView, connectedAddress: string | null) {
  return useInfiniteQuery({
    queryKey: ['auctions', view.segment, view.search, view.assetSymbol, view.sort, connectedAddress],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const query = buildAuctionQuery(view, connectedAddress, pageParam, PAGE_LIMIT)
      const result = await fetchAuctionPage(query)
      // TanStack Query marks a query failed by a thrown error; this is the one
      // place a Result is adapted to that contract. SKILL_GENERAL section 5
      // permits throwing for frameworks that drive retries through thrown
      // errors. The route reads isError as "indexer down, fall back to RPC".
      if (!result.ok) {
        throw new Error(`${result.error.kind}: ${result.error.detail}`)
      }
      return result.value
    },
    getNextPageParam: (lastPage: IndexerPage) => lastPage.nextCursor,
    staleTime: POLL_INTERVAL_MS,
    retry: 1,
  })
}
