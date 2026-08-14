import { type StravaActivity } from './strava'
import { type FtpHistoryEntry } from './performance'
import { calculateTSS, classifySport, type TssThresholds } from './tss'

export interface FitnessDay {
  date: string // YYYY-MM-DD
  ctl: number // Chronic Training Load — fitness
  atl: number // Acute Training Load — fatigue
  tsb: number // Training Stress Balance — form
  tss: number // load accumulated on this day
  ftp: number // FTP in effect on this day
}

export interface FitnessSeries {
  days: FitnessDay[]
  /** Date → the load this curve actually used for that day. Read weekly and
   * daily totals from here rather than re-summing calculateTSS with a
   * different thresholds object — that is how the plan page ended up showing
   * a weekly total that disagreed with the curve beside it. */
  dailyTss: Map<string, number>
  latest: FitnessDay | null
}

/** Everything the curve needs to know about the athlete. AthleteProfile
 * satisfies this, so callers pass the profile straight through. */
export interface FitnessInputs {
  ftpHistory: FtpHistoryEntry[]
  thresholds: TssThresholds
}

const CTL_TIME_CONSTANT_DAYS = 42
const ATL_TIME_CONSTANT_DAYS = 7

/** FTP in effect on `date`. Returns 0 for an empty history, which is fine:
 * calculateTSS then falls back to hrTSS or rTSS. */
function ftpOn(date: string, sortedHistory: FtpHistoryEntry[]): number {
  let ftp = sortedHistory[0]?.ftp || 0
  for (const entry of sortedHistory) {
    if (entry.date > date) break
    ftp = entry.ftp
  }
  return ftp
}

/** An activity contributes load if we can derive any for it. */
function carriesLoad(a: StravaActivity): boolean {
  const sport = classifySport(a)
  if (sport === 'other') return false
  // A reported intervals.icu load is enough on its own — calculateTSS prefers
  // it over the averages anyway.
  if (a.suffer_score) return true
  if (sport === 'cycling') return Boolean(a.average_watts || a.average_heartrate)
  return a.average_speed > 0 || Boolean(a.average_heartrate)
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The fitness curve — CTL, ATL and form per day, plus the daily load it used.
 *
 * One entry point on purpose. Callers used to run estimateFTPHistory, guard the
 * empty case, and hand in a TssThresholds whose `ftp` field this function then
 * overwrote per-day from the history — a parameter you could not know was
 * ignored by reading the signature. Both callers duplicated that assembly and
 * the plan page got it wrong, summing its own TSS with a different FTP than the
 * curve used.
 *
 * The curve is no longer gated on having a power-derived FTP history. An
 * HR-only cyclist or a runner has perfectly computable load through hrTSS and
 * rTSS, and used to be shown an empty chart.
 */
export function fitnessSeries(
  activities: StravaActivity[],
  { ftpHistory, thresholds }: FitnessInputs,
  today: Date = new Date()
): FitnessSeries {
  const tracked = activities.filter(carriesLoad)
  const empty: FitnessSeries = { days: [], dailyTss: new Map(), latest: null }
  if (tracked.length === 0) return empty

  const byDay = new Map<string, StravaActivity[]>()
  for (const a of tracked) {
    const day = a.start_date_local.split('T')[0]
    const bucket = byDay.get(day)
    if (bucket) bucket.push(a)
    else byDay.set(day, [a])
  }

  const earliest = tracked
    .map((a) => new Date(a.start_date_local))
    .reduce((min, d) => (d < min ? d : min))
  earliest.setHours(0, 0, 0, 0)

  const end = new Date(today)
  end.setHours(23, 59, 59, 999)

  const sortedFtp = [...ftpHistory].sort((a, b) => a.date.localeCompare(b.date))

  const days: FitnessDay[] = []
  const dailyTss = new Map<string, number>()
  let ctl = 0
  let atl = 0

  for (const d = new Date(earliest); d <= end; d.setDate(d.getDate() + 1)) {
    const date = dateKey(d)
    const ftp = ftpOn(date, sortedFtp)

    let tss = 0
    const onThisDay = byDay.get(date)
    if (onThisDay) {
      // FTP is the one in effect on that date, so a curve built over years
      // scores each ride against the fitness the athlete had at the time.
      const dayThresholds: TssThresholds = { ...thresholds, ftp }
      for (const a of onThisDay) tss += calculateTSS(a, dayThresholds)
    }
    dailyTss.set(date, tss)

    ctl += (tss - ctl) / CTL_TIME_CONSTANT_DAYS
    atl += (tss - atl) / ATL_TIME_CONSTANT_DAYS

    days.push({
      date,
      // Keep one decimal: CTL moves by at most ctl/42 (~1.3) per day, so
      // integer rounding makes a smooth decay look like an overnight jump.
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
      ftp,
    })
  }

  return { days, dailyTss, latest: days[days.length - 1] ?? null }
}

/** Total load over a half-open date range [from, to) — read from the same map
 * the curve used, so a weekly total can never disagree with the curve. */
export function loadBetween(series: FitnessSeries, from: Date, to: Date): number {
  let total = 0
  for (const [date, tss] of series.dailyTss) {
    const d = new Date(`${date}T00:00:00`)
    if (d >= from && d < to) total += tss
  }
  return total
}
