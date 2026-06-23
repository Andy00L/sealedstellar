// A generic glass segmented control: a row of toggle buttons sharing the
// redesign's frosted pill look. Used by the segment tabs, the sort control, and
// the density toggle so that idiom lives in one place rather than three copies.
// It mirrors the markup of the room's PerspectiveSwitch, which stays a separate
// hardcoded control to avoid touching the room route in this change.

import { cn } from '@/lib/utils'

export type SegmentedOption<ValueType extends string> = {
  value: ValueType
  label: string
  disabled?: boolean
  title?: string
}

type GlassSegmentedControlProps<ValueType extends string> = {
  options: readonly SegmentedOption<ValueType>[]
  value: ValueType
  onChange: (next: ValueType) => void
  ariaLabel: string
}

export function GlassSegmentedControl<ValueType extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: GlassSegmentedControlProps<ValueType>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[13px] border border-white/70 bg-white/55 p-1 backdrop-blur-md"
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              isActive
                ? 'bg-white/90 text-foreground shadow-[0_2px_8px_rgba(40,38,52,.12)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
