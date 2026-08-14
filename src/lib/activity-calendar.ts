import { addDays, eachDayOfInterval, format, getDay, startOfWeek } from 'date-fns'
import { type StravaActivity } from './strava'
import { type FitnessSeries } from './fitness'

/** One day in the grid. Days with no activity still get a cell — the gaps are
 * as much of the story as the streaks. */
export interface CalendarDay {
  date: string // YYYY-MM-DD
  activities: StravaActivity[]
  count: number
  movingTime: number // seconds
  distance: number // meters
  elevation: number // meters
  load: number // training load, from the fitness curve
  /** 0 = nothing, 1..6 = band of the non-empty days in view. See LEVEL_QUANTILES. */
  level: number
  /** Hasn't happened yet. Drawn faintly so the year keeps its full shape
   * without the remaining months reading as days you missed. */
  isFuture: boolean
}

export type CalendarMetric = 'load' | 'time'

export interface CalendarSummary {
  days: number // days in the period
  activeDays: number
  activities: number
  movingTime: number
  distance: number
  elevation: number
  load: number
  longestStreak: number
  currentStreak: number
  /** The busiest single day in view, by the selected metric. */
  best: CalendarDay | null
}

export interface ActivityCalendar {
  /** Columns, each a Monday-start week. Cells outside the range are null so
   * the first and last columns keep their shape. */
  weeks: Array<Array<CalendarDay | null>>
  /** Month name + the column it starts in, for the axis above the grid. */
  monthLabels: Array<{ label: string; weekIndex: number }>
  summary: CalendarSummary
  /** Upper bound of levels 1–3; anything above the last is level 4. */
  thresholds: number[]
  metric: CalendarMetric
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function metricValue(day: CalendarDay, metric: CalendarMetric): number {
  return metric === 'load' ? day.load : day.movingTime
}

/**
 * Where the level boundaries sit, as quantiles of the days that actually have
 * something on them.
 *
 * Two decisions here.
 *
 * *Quantiles, not fixed numbers.* 60 TSS is a big day in base and a recovery
 * spin in a build block, so absolute cutoffs would misread whole seasons. This
 * keeps every level in use whatever the year holds — the grid is for reading
 * the shape of a block, not for looking up values.
 *
 * *Weighted to the tail.* Training load is heavily right-skewed: a lot of
 * ordinary days, a handful of big ones. Under plain quartiles the top band held
 * everything above the 75th percentile, so a 160 km epic and a solid 50 km ride
 * drew the same colour — a quarter of all riding days shared the brightest
 * shade, which made "brightest" mean nothing. The last two bands are narrow
 * (80th and 95th) so genuinely exceptional days separate from merely good ones.
 */
export const LEVEL_QUANTILES = [0.2, 0.4, 0.6, 0.8, 0.95]

/** One more than the number of cutoffs — the top band is everything above the last. */
export const MAX_LEVEL = LEVEL_QUANTILES.length + 1

export function levelThresholds(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return LEVEL_QUANTILES.map(() => 0)
  const at = (q: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * q))]
  return LEVEL_QUANTILES.map(at)
}

export function levelFor(value: number, thresholds: number[]): number {
  if (value <= 0) return 0
  for (let i = 0; i < thresholds.length; i++) {
    if (value <= thresholds[i]) return i + 1
  }
  return thresholds.length + 1
}

/** Longest and current run of consecutive active days, oldest-first input. */
export function streaks(days: CalendarDay[]): { longest: number; current: number } {
  let longest = 0
  let run = 0
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0
    if (run > longest) longest = run
  }
  // Current streak counts back from the end, ignoring a still-empty today.
  let current = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) current++
    else if (i === days.length - 1) continue // today may not have happened yet
    else break
  }
  return { longest, current }
}

/**
 * Lay activities out as a GitHub-style contribution grid.
 *
 * Colour comes from training load or moving time rather than activity count.
 * Count barely varies — almost every active day has exactly one activity — so
 * it would render as a near-binary grid and waste the encoding. Load and time
 * both have real spread across a training block.
 */
export function buildActivityCalendar(
  activities: StravaActivity[],
  fitness: FitnessSeries,
  from: Date,
  to: Date,
  metric: CalendarMetric = 'load',
  today: Date = new Date()
): ActivityCalendar {
  const byDay = new Map<string, StravaActivity[]>()
  for (const a of activities) {
    const key = (a.start_date_local || a.start_date).split('T')[0]
    const bucket = byDay.get(key)
    if (bucket) bucket.push(a)
    else byDay.set(key, [a])
  }

  const todayKey = format(today, 'yyyy-MM-dd')
  const days: CalendarDay[] = eachDayOfInterval({ start: from, end: to }).map((d) => {
    const date = format(d, 'yyyy-MM-dd')
    const dayActivities = byDay.get(date) ?? []
    return {
      date,
      activities: dayActivities,
      count: dayActivities.length,
      movingTime: dayActivities.reduce((s, a) => s + a.moving_time, 0),
      distance: dayActivities.reduce((s, a) => s + a.distance, 0),
      elevation: dayActivities.reduce((s, a) => s + a.total_elevation_gain, 0),
      load: fitness.dailyTss.get(date) ?? 0,
      level: 0,
      isFuture: date > todayKey,
    }
  })

  // Everything below counts only days that have happened. A year in progress
  // shows its full shape, but "58% of days active" would be nonsense if the
  // remaining months counted against it.
  const elapsed = days.filter((d) => !d.isFuture)

  const thresholds = levelThresholds(elapsed.map((d) => metricValue(d, metric)))
  for (const d of days) d.level = levelFor(metricValue(d, metric), thresholds)

  // Columns are Monday-start weeks; pad the first and last so every column has
  // seven rows and the weekday axis lines up.
  const byDate = new Map(days.map((d) => [d.date, d]))
  const gridStart = startOfWeek(from, { weekStartsOn: 1 })
  const weeks: Array<Array<CalendarDay | null>> = []
  const monthLabels: Array<{ label: string; weekIndex: number }> = []
  let lastMonth = ''

  for (let cursor = gridStart; cursor <= to; cursor = addDays(cursor, 7)) {
    const week: Array<CalendarDay | null> = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i)
      week.push(byDate.get(format(d, 'yyyy-MM-dd')) ?? null)
    }
    // Label a column with its month when the month changes, so labels sit at
    // the start of each month rather than being repeated.
    const firstReal = week.find((d): d is CalendarDay => d != null)
    if (firstReal) {
      const month = firstReal.date.slice(0, 7)
      if (month !== lastMonth) {
        monthLabels.push({ label: format(new Date(`${firstReal.date}T00:00:00`), 'MMM'), weekIndex: weeks.length })
        lastMonth = month
      }
    }
    weeks.push(week)
  }

  const active = elapsed.filter((d) => d.count > 0)
  const { longest, current } = streaks(elapsed)
  const best = active.length > 0
    ? active.reduce((a, b) => (metricValue(b, metric) > metricValue(a, metric) ? b : a))
    : null

  return {
    weeks,
    monthLabels,
    thresholds,
    metric,
    summary: {
      days: elapsed.length,
      activeDays: active.length,
      activities: active.reduce((s, d) => s + d.count, 0),
      movingTime: active.reduce((s, d) => s + d.movingTime, 0),
      distance: active.reduce((s, d) => s + d.distance, 0),
      elevation: active.reduce((s, d) => s + d.elevation, 0),
      load: elapsed.reduce((s, d) => s + d.load, 0),
      longestStreak: longest,
      currentStreak: current,
      best,
    },
  }
}

/** Which weekday column index a date sits in, Monday = 0. */
export function weekdayIndex(date: Date): number {
  return (getDay(date) + 6) % 7
}
