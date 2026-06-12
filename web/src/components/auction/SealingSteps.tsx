// The sealing pipeline checklist: five real steps, each advancing on actual
// completion (no demo timers). done = accent check, active = spinner,
// idle = dashed dot.
// sourceRef: design-handoff/stellar/project/ss-flows.jsx SealStep/sealSteps.

import { Check } from 'lucide-react'

const SEALING_STEP_LABELS = [
  'Salt generated locally',
  'Commitment computed (Poseidon)',
  'Encrypted to operator',
  'Waiting for wallet signature…',
  'Submitted to testnet',
] as const

type SealingStepsProps = {
  completedSteps: number
}

export function SealingSteps({ completedSteps }: SealingStepsProps) {
  return (
    <div className="grid gap-3 py-1.5">
      {SEALING_STEP_LABELS.map((stepLabel, stepIndex) => {
        const stepState =
          stepIndex < completedSteps ? 'done' : stepIndex === completedSteps ? 'active' : 'idle'
        return (
          <div key={stepLabel} className="flex items-center gap-2.5">
            <span className="grid w-4 place-items-center">
              {stepState === 'done' && (
                <span className="text-primary">
                  <Check size={13} strokeWidth={3} aria-hidden="true" />
                </span>
              )}
              {stepState === 'active' && (
                <span
                  className="size-3 animate-spin rounded-full border-2 border-[color-mix(in_oklab,var(--primary)_25%,#FFFFFF)] border-t-primary"
                  aria-hidden="true"
                />
              )}
              {stepState === 'idle' && (
                <span
                  className="size-2.5 rounded-full border-[1.5px] border-dashed border-foreground/18"
                  aria-hidden="true"
                />
              )}
            </span>
            <span
              className={
                stepState === 'idle' ? 'text-sm text-ink-faint' : 'text-sm text-foreground'
              }
            >
              {stepLabel}
            </span>
          </div>
        )
      })}
    </div>
  )
}
