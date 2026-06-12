// Auction room route. Milestone 3 lands the full room (header, countdown,
// sealed bid grid); until then the shell stays honest about what is here.

import { Link, useParams } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function AuctionRoomRoute() {
  const { auctionId } = useParams()

  return (
    <AppShell>
      <div className="mx-auto grid max-w-xl gap-3.5 px-5 py-6 sm:px-7">
        <Card className="grid justify-items-start gap-3 rounded-xl border-border-soft p-6 shadow-card">
          <span className="text-[17px] font-semibold">Auction {auctionId}</span>
          <span className="text-sm text-muted-foreground">
            The auction room ships in the next milestone; the list already tracks this auction
            live.
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Back to auctions</Link>
          </Button>
        </Card>
      </div>
    </AppShell>
  )
}
