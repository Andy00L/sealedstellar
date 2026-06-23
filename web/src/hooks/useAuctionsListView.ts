// Bridges the URL query string to the typed auctions list-view model. The URL
// is the single source of truth (shareable, survives reload), so view state is
// derived during render rather than synced through an effect.
// Why new: no hook mapped useSearchParams to a typed view model.

import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { readListView, writeListView, type AuctionsListView } from '@/lib/auctions-list-view'

export function useAuctionsListView(): {
  view: AuctionsListView
  setView: (next: Partial<AuctionsListView>) => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = readListView(searchParams)

  // replace: true so typing in the search box does not push one history entry
  // per keystroke. The functional updater merges against the latest params.
  const setView = useCallback(
    (next: Partial<AuctionsListView>) => {
      setSearchParams((current) => writeListView(current, next), { replace: true })
    },
    [setSearchParams],
  )

  return { view, setView }
}
