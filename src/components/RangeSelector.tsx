/** Shared time range selector button group used across chart components */

export const rangeOptions = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m', days: 180 },
  { label: '1y', days: 365 },
  { label: 'All', days: 0 },
] as const

interface RangeSelectorProps {
  days: number
  onChange: (days: number) => void
  /** The range the top-bar filter is set to, when this card can follow it. */
  globalDays?: number
  /** True when the card has been pulled off the global range. */
  isOverride?: boolean
  /** Puts the card back on the global range. */
  onReset?: () => void
}

export function RangeSelector({
  days,
  onChange,
  isOverride = false,
  onReset,
}: RangeSelectorProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1 bg-bg-tertiary rounded-[var(--radius-sm)] p-0.5">
        {rangeOptions.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.days)}
            aria-pressed={days === opt.days}
            className={`text-[0.75rem] font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              days === opt.days
                ? 'bg-accent text-bg-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Without this marker a card on its own range is indistinguishable from
          one following the top bar, and the two disagree silently. */}
      {isOverride && onReset && (
        <button
          type="button"
          onClick={onReset}
          title="Follow the time range in the top bar"
          className="flex items-center gap-1 text-[0.75rem] font-medium text-warning bg-warning-muted border border-warning/30 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors hover:bg-warning/20"
        >
          Overriding global
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
