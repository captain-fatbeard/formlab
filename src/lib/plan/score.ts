import { addDays, format, isSameDay, isToday, subDays } from 'date-fns'
import { type StravaActivity } from '../strava'
import { rollup } from '../rollup'
import { loadBetween, type FitnessSeries } from '../fitness'
import { templateFor } from './templates'
import {
  type DayActual,
  type FitVerdict,
  type FitnessSnapshot,
  type PlanDay,
  type PlanPhase,
  type PlanSession,
  type SessionType,
  type WeekSummary,
} from './types'

/** What actually happened on a day — one summary over however many activities. */
export function aggregateDay(activities: StravaActivity[], date: Date): DayActual | null {
  const matches = activities.filter((a) =>
    isSameDay(new Date(a.start_date_local || a.start_date), date)
  )
  const summary = rollup(matches)
  if (!summary) return null

  return {
    movingTimeMin: summary.movingTime / 60,
    avgPower: summary.avgWatts ?? null,
    np: summary.normalizedWatts ?? null,
    avgHr: summary.avgHeartrate ?? null,
    distance: summary.distance,
    activities: matches,
  }
}

/** A short easy spin still counts as compliant rest. */
const REST_SPIN_MAX_MIN = 30
const REST_SPIN_MAX_IF = 0.5

/** How the day that happened compares to the day that was planned. */
export function computeFit(
  session: PlanSession,
  actual: DayActual | null,
  ftp: number
): FitVerdict {
  if (session.type === 'rest') {
    if (!actual) return 'on-target'
    if (actual.movingTimeMin <= REST_SPIN_MAX_MIN && (actual.avgPower ?? 0) < ftp * REST_SPIN_MAX_IF) {
      return 'on-target'
    }
    return 'rest-skipped'
  }

  if (!actual) return 'none'

  if (actual.movingTimeMin > session.durationMaxMin) return 'over-duration'
  if (actual.movingTimeMin < session.durationMinMin) return 'under-duration'

  if (session.powerCeiling !== null && actual.avgPower !== null) {
    if (actual.avgPower > ftp * session.powerCeiling) return 'above'
  }
  if (session.powerFloor !== null && actual.avgPower !== null) {
    if (actual.avgPower < ftp * session.powerFloor) return 'below'
  }

  return 'on-target'
}

/** A day counts toward adherence when it hit the plan, came in short, or came
 * in easy on a session where easy was allowed. */
export function countsAsOnPlan(day: PlanDay): boolean {
  if (day.verdict === 'on-target' || day.verdict === 'under-duration') return true
  if (day.verdict === 'below') return day.session.allowBelow
  return false
}

export interface WeekInput {
  weekStart: Date
  today: Date
  activities: StravaActivity[]
  fitness: FitnessSeries
  ftp: number
  phase: PlanPhase
  dayOverrides?: Record<number, SessionType>
}

function roundSnap(p: FitnessSnapshot | null | undefined): FitnessSnapshot | null {
  return p ? { ctl: Math.round(p.ctl), atl: Math.round(p.atl), tsb: Math.round(p.tsb) } : null
}

/**
 * Everything the plan page needs to know about one week: the days with their
 * verdicts, adherence, and the fitness the week started and ended on.
 *
 * Takes one options object rather than seven positional parameters — the
 * previous signature made it easy to pass the wrong thresholds, which is
 * exactly the bug that had the weekly total disagreeing with the curve.
 */
export function summarizeWeek({
  weekStart, today, activities, fitness, ftp, phase, dayOverrides,
}: WeekInput): WeekSummary {
  const paused = phase === 'paused'
  const template = templateFor(phase, dayOverrides)

  const days: PlanDay[] = template.map((session, i) => {
    const date = addDays(weekStart, i)
    const isPastOrToday = date <= today
    const thisDayIsToday = isToday(date)
    const actual = isPastOrToday ? aggregateDay(activities, date) : null

    let verdict: FitVerdict
    if (paused) verdict = 'paused'
    else if (!isPastOrToday) verdict = 'future'
    else if (thisDayIsToday && !actual && session.type !== 'rest') verdict = 'pending'
    else verdict = computeFit(session, actual, ftp)

    return { session, date, actual, verdict, isToday: thisDayIsToday, isPastOrToday }
  })

  // Paused weeks score nothing — riding isn't "rest skipped", skipping isn't "missed".
  const scored = paused ? [] : days.filter((d) => d.isPastOrToday && d.verdict !== 'pending')
  const onPlan = scored.filter(countsAsOnPlan).length
  const adherencePct = scored.length > 0 ? Math.round((onPlan / scored.length) * 100) : 0
  const sessionsLogged = scored.filter((d) => d.actual !== null || d.session.type === 'rest').length

  const weekEnd = addDays(weekStart, 6)
  const startKey = format(subDays(weekStart, 1), 'yyyy-MM-dd')
  const endKey = format(weekEnd > today ? today : weekEnd, 'yyyy-MM-dd')
  const startSnap = roundSnap(fitness.days.find((p) => p.date === startKey))
  const endSnap = roundSnap(fitness.days.find((p) => p.date === endKey) ?? fitness.latest)

  const weekActivities = activities.filter((a) => {
    const ad = new Date(a.start_date_local || a.start_date)
    return ad >= weekStart && ad < addDays(weekStart, 7)
  })

  return {
    weekStart,
    weekEnd,
    phase,
    days,
    adherencePct,
    sessionsLogged,
    scoredCount: scored.length,
    startSnap,
    endSnap,
    totalTimeMin: weekActivities.reduce((s, a) => s + a.moving_time, 0) / 60,
    totalActivities: weekActivities.length,
    // Read the load the curve actually used rather than re-summing it here —
    // the two used to come from different FTPs and disagreed on screen.
    actualTSS: loadBetween(fitness, weekStart, addDays(weekStart, 7)),
  }
}
