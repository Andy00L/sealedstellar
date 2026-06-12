// Theme specimen: milestone 1 eyeball target. Mirrors the hi-fi "Direction"
// artboard so extracted tokens can be checked against the design one to one.
// sourceRef: design-handoff/stellar/project/ss-main.jsx ThemeSpecimen.

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/auction/StatusPill'
import { VerifiedStamp } from '@/components/auction/VerifiedStamp'
import { WaxSeal } from '@/components/auction/WaxSeal'

type SwatchProps = {
  colorValue: string
  name: string
  note: string
  bordered?: boolean
}

function Swatch({ colorValue, name, note, bordered = false }: SwatchProps) {
  return (
    <div className="grid justify-items-start gap-1.5">
      <span
        className={`h-11 w-16 rounded-[10px] shadow-[0_1px_3px_rgba(29,29,31,0.06)] ${bordered ? 'border border-border' : ''}`}
        style={{ background: colorValue }}
      />
      <span className="text-[11.5px] font-semibold">{name}</span>
      <span className="font-mono -mt-1 text-[10px] text-muted-foreground">{note}</span>
    </div>
  )
}

export function SpecimenRoute() {
  return (
    <div className="min-h-screen bg-background p-7">
      <div className="grid max-w-2xl gap-6">
        <div className="text-[13px] font-semibold text-muted-foreground">
          Theme specimen (milestone 1 check against the hi-fi Direction artboard)
        </div>

        <div className="flex flex-wrap gap-4.5">
          <Swatch colorValue="var(--background)" name="Background" note="#FAF9F6 cream" bordered />
          <Swatch colorValue="var(--card)" name="Surface" note="#FFFFFF" bordered />
          <Swatch colorValue="var(--foreground)" name="Ink" note="#1D1D1F" />
          <Swatch colorValue="var(--muted-foreground)" name="Secondary" note="#6E6E73" />
          <Swatch colorValue="var(--primary)" name="Accent" note="interactive only" />
          <Swatch colorValue="var(--verified)" name="Verified green" note="stamp only" />
          <Swatch colorValue="var(--wax)" name="Wax" note="seal motif only" />
        </div>

        <div className="grid gap-2.5 border-t border-border-soft pt-5">
          <div className="font-mono text-[34px] font-semibold tracking-[-0.01em] tabular-nums">
            02:14:09
          </div>
          <div className="text-2xl font-semibold tracking-[-0.015em]">50,000 tBENJI</div>
          <div className="text-[15px]">
            Body text is the system stack at 15 to 16px, weight 600 maximum, sentence case
            everywhere.
          </div>
          <div className="text-[13px] text-muted-foreground">
            Captions and metadata sit at 12 to 13.5px in secondary ink.
          </div>
          <div className="font-mono text-[12.5px] tabular-nums">
            c0a4…9e1d · commitments always in mono with tabular numerals
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-5">
          <Button>Place sealed bid</Button>
          <Button variant="outline">Connect wallet</Button>
          <StatusPill status="open" />
          <StatusPill status="awaiting" />
          <StatusPill status="settled" />
          <StatusPill status="refunded" />
          <VerifiedStamp small />
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-border-soft pt-5">
          <WaxSeal size={54} />
          <WaxSeal size={38} />
          <WaxSeal size={28} />
          <VerifiedStamp />
        </div>

        <div className="grid max-w-sm gap-3 border-t border-border-soft pt-5">
          <Progress value={60} />
          <div className="flex gap-3">
            <Skeleton className="h-[17px] w-32" />
            <Skeleton className="h-[17px] w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}
