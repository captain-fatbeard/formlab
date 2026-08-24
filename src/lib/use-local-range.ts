import { useState } from 'react'
import { useDashboard } from './dashboard-context'

/**
 * A card's own time range, defaulting to the global one.
 *
 * Performance used to hold three independent range pickers that all started at
 * 90 days regardless of the top-bar filter, so comparing three charts over one
 * window meant changing three controls — and on Health, one card obeyed its own
 * picker while the two below it obeyed the global range, with nothing marking
 * the difference. Here the local picker is an override, and says so.
 */
export function useLocalRange() {
  const { timeRange, timeRangeDays } = useDashboard()
  const globalDays = timeRange === 'all' ? 0 : timeRangeDays

  const [override, setOverride] = useState<number | null>(null)
  const days = override ?? globalDays

  return {
    days,
    globalDays,
    isOverride: override !== null && override !== globalDays,
    setDays: (value: number) => setOverride(value),
    reset: () => setOverride(null),
  }
}
