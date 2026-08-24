import { useDashboard } from '~/lib/dashboard-context'
import type { TimeRange, ActivityType } from '~/lib/dashboard-context'
import {
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_SHORT,
} from '~/lib/labels'

interface FilterPillProps<T extends string> {
  label: string
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  /** What the pill shows when closed — shorter than the option text. */
  display: string
}

/**
 * A native select wearing a pill. Native keeps the keyboard, the mobile
 * picker and the accessible name for free; the pill is what makes the current
 * value readable without opening anything.
 */
function FilterPill<T extends string>({
  label,
  value,
  onChange,
  options,
  display,
}: FilterPillProps<T>) {
  return (
    <div className="relative flex items-center h-8 rounded-[var(--radius-sm)] bg-bg-tertiary border border-border text-text-secondary transition-colors duration-150 hover:border-text-muted hover:text-text-primary focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
      <span className="flex items-center gap-1.5 pl-3.5 pr-2.5 text-[0.75rem] font-medium whitespace-nowrap">
        {display}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 8L2 4h8z" />
        </svg>
      </span>
      <select
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function entries<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }))
}

/**
 * Time Range and Activity Type — the two controls that silently decide what
 * most of the app's numbers mean. They used to live in a drawer behind the
 * avatar, which is universally the account menu.
 */
export function GlobalFilters() {
  const { timeRange, setTimeRange, activityType, setActivityType } = useDashboard()

  return (
    <div className="flex items-center gap-2 min-w-0">
      <FilterPill<TimeRange>
        label="Time range"
        value={timeRange}
        onChange={setTimeRange}
        options={entries(TIME_RANGE_LABELS)}
        display={TIME_RANGE_SHORT[timeRange]}
      />
      <FilterPill<ActivityType>
        label="Activity type"
        value={activityType}
        onChange={setActivityType}
        options={entries(ACTIVITY_TYPE_LABELS)}
        display={ACTIVITY_TYPE_SHORT[activityType]}
      />
    </div>
  )
}
