import { startOfDay, subDays } from 'date-fns'
import type { StravaActivity } from './strava'
import type { FitnessSeries } from './fitness'
import { loadBetween } from './fitness'
import type { WeightEntry } from './storage/supabase-client'

export interface WeekChange {
  id: string
  label: string
  /** The current value, already formatted. */
  value: string
  /** The change against the previous week, already formatted, or null when
   *  there is nothing to compare against. */
  delta: string | null
  /** Which way the change reads for a rider. */
  tone: 'up' | 'down' | 'flat'
  /** One line on what the number is. */
  hint: string
}

function pct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function signed(value: number, unit = '', decimals = 0): string {
  const rounded = Number(value.toFixed(decimals))
  return `${rounded > 0 ? '+' : ''}${rounded}${unit}`
}

/**
 * What actually moved in the last seven days.
 *
 * The app computes CTL, TSB, weight trends and weekly load and then never says
 * what changed — the landing page listed lifetime totals, which are the same
 * numbers every day. These three are deliberately about *this week*, and each
 * one carries its own window in its hint.
 */
export function weekChanges(
  activities: StravaActivity[],
  fitness: FitnessSeries,
  weightEntries: WeightEntry[],
  now: Date = new Date()
): WeekChange[] {
  const today = startOfDay(now)
  const weekStart = subDays(today, 6)
  const previousStart = subDays(weekStart, 7)

  const thisWeekLoad = loadBetween(fitness, weekStart, subDays(today, -1))
  const lastWeekLoad = loadBetween(fitness, previousStart, weekStart)

  const inWindow = (from: Date, to: Date) =>
    activities.filter((a) => {
      const date = new Date(a.start_date_local || a.start_date)
      return date >= from && date < to
    })

  const thisWeekActivities = inWindow(weekStart, subDays(today, -1))
  const lastWeekActivities = inWindow(previousStart, weekStart)
  const hours = (list: StravaActivity[]) => list.reduce((sum, a) => sum + a.moving_time, 0) / 3600

  const changes: WeekChange[] = []

  const loadChange = pct(thisWeekLoad, lastWeekLoad)
  changes.push({
    id: 'load',
    label: 'Training load',
    value: `${Math.round(thisWeekLoad)} TSS`,
    delta: loadChange == null ? null : `${signed(loadChange, '%')}`,
    tone: loadChange == null || Math.abs(loadChange) < 5 ? 'flat' : loadChange > 0 ? 'up' : 'down',
    hint: 'Last 7 days vs the 7 before',
  })

  const hoursChange = hours(thisWeekActivities) - hours(lastWeekActivities)
  changes.push({
    id: 'hours',
    label: 'Time on the bike',
    value: `${hours(thisWeekActivities).toFixed(1)} h`,
    delta: lastWeekActivities.length === 0 ? null : `${signed(hoursChange, ' h', 1)}`,
    tone: Math.abs(hoursChange) < 0.2 ? 'flat' : hoursChange > 0 ? 'up' : 'down',
    hint: `${thisWeekActivities.length} ${thisWeekActivities.length === 1 ? 'activity' : 'activities'} this week`,
  })

  // Form is the one number here that is a state rather than a total, so it
  // reports where it is now and how far it has moved in a week.
  const latest = fitness.latest
  const weekAgo = fitness.days[fitness.days.length - 8]
  if (latest) {
    const tsbDelta = weekAgo ? latest.tsb - weekAgo.tsb : null
    changes.push({
      id: 'form',
      label: 'Form',
      value: `${latest.tsb > 0 ? '+' : ''}${Math.round(latest.tsb)}`,
      delta: tsbDelta == null ? null : signed(tsbDelta),
      tone: tsbDelta == null || Math.abs(tsbDelta) < 2 ? 'flat' : tsbDelta > 0 ? 'up' : 'down',
      hint: `Fitness ${Math.round(latest.ctl)}, fatigue ${Math.round(latest.atl)}`,
    })
  }

  if (weightEntries.length > 0) {
    const sorted = [...weightEntries].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    )
    const current = sorted[0]
    const monthAgo = sorted.find((e) => new Date(e.recordedAt) <= subDays(today, 28))
    const delta = monthAgo ? current.weight - monthAgo.weight : null
    changes.push({
      id: 'weight',
      label: 'Weight',
      value: `${current.weight.toFixed(1)} kg`,
      delta: delta == null ? null : signed(delta, ' kg', 1),
      tone: delta == null || Math.abs(delta) < 0.2 ? 'flat' : delta > 0 ? 'up' : 'down',
      hint: monthAgo ? 'Against 4 weeks ago' : 'No reading 4 weeks back',
    })
  }

  return changes
}
