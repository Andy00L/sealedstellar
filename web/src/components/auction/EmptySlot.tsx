// Unfilled bid slot: a quiet dashed square.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html empty slot.

export function EmptySlot() {
  return (
    <div className="grid aspect-square place-items-center rounded-2xl border-[1.5px] border-dashed border-foreground/16 bg-white/18">
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Empty</span>
    </div>
  )
}
