// Red failure notice: one sentence per failure mode, never a code.
// sourceRef: design-handoff/stellar/project/ss-flows.jsx BidErrorNotice.

type BidErrorNoticeProps = {
  message: string
}

export function BidErrorNotice({ message }: BidErrorNoticeProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-[color-mix(in_oklab,var(--destructive)_28%,#FFFFFF)] bg-[color-mix(in_oklab,var(--destructive)_6%,#FFFFFF)] px-3.5 py-2.75">
      <span className="mt-px grid size-[17px] shrink-0 place-items-center rounded-full bg-destructive text-[11.5px] font-semibold text-destructive-foreground">
        !
      </span>
      <span className="text-[13.5px] leading-[1.5]">{message}</span>
    </div>
  )
}
