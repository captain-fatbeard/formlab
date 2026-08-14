import { type StravaActivity } from './strava'
import { isIntervalsActivityId } from './intervals'

export type Sport = 'cycling' | 'running' | 'other'

export interface TssThresholds {
  ftp: number
  cyclingLTHR: number | null
  runningLTHR: number | null
  runningThresholdPace: number | null // m/s, GAP-adjusted
  maxHR: number
  restingHR: number
}

export type ThresholdSource = 'derived' | 'estimated' | 'unavailable'

export interface ThresholdSources {
  cyclingLTHR: ThresholdSource
  runningLTHR: ThresholdSource
  runningThresholdPace: ThresholdSource
}

export interface ThresholdResult {
  thresholds: TssThresholds
  sources: ThresholdSources
}

const CYCLING_TYPES = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide', 'Velomobile', 'Handcycle'])
const RUNNING_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun'])

const DERIVATION_WINDOW_DAYS = 180
const MIN_RIDE_DURATION_S = 1800 // 30 min
const MIN_RUN_DURATION_S = 1200 // 20 min
const MIN_QUALIFYING_EFFORTS = 3
const TOP_EFFORTS = 3
const MAX_INTENSITY_FACTOR = 1.15

export function classifySport(activity: StravaActivity): Sport {
  const t = activity.sport_type || activity.type
  if (CYCLING_TYPES.has(t)) return 'cycling'
  if (RUNNING_TYPES.has(t)) return 'running'
  return 'other'
}

// Minetti et al. 2002 — energy cost of running on a gradient (J/kg/m).
// Valid roughly for -0.45 ≤ g ≤ 0.45.
function runningEnergyCost(grade: number): number {
  const g = Math.max(-0.30, Math.min(0.30, grade))
  return (
    155.4 * g ** 5 -
    30.4 * g ** 4 -
    43.3 * g ** 3 +
    46.3 * g ** 2 +
    19.5 * g +
    3.6
  )
}

// GAP factor: how much faster equivalent flat pace would be vs. recorded pace,
// given total elevation gain and distance. Assumes a typical loop where half
// the distance climbs and half descends at the same average grade.
export function gapFactor(elevationGain: number, distance: number): number {
  if (distance <= 0 || elevationGain <= 0) return 1
  const climbingDistance = distance / 2
  const avgClimbGrade = elevationGain / climbingDistance
  const climbCost = runningEnergyCost(avgClimbGrade)
  const descentCost = runningEnergyCost(-avgClimbGrade)
  const flatCost = runningEnergyCost(0)
  return (climbCost + descentCost) / 2 / flatCost
}

export function gradeAdjustedSpeed(activity: StravaActivity): number {
  return activity.average_speed * gapFactor(activity.total_elevation_gain || 0, activity.distance || 0)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function powerTSS(activity: StravaActivity, ftp: number): number {
  const np = activity.weighted_average_watts || activity.average_watts
  if (!np || ftp <= 0) return 0
  const intensityFactor = np / ftp
  const hours = activity.moving_time / 3600
  return Math.round(hours * intensityFactor * intensityFactor * 100)
}

function hrTSS(activity: StravaActivity, lthr: number): number {
  const hr = activity.average_heartrate
  if (!hr || lthr <= 0) return 0
  const intensityFactor = clamp(hr / lthr, 0, MAX_INTENSITY_FACTOR)
  const hours = activity.moving_time / 3600
  return Math.round(hours * intensityFactor * intensityFactor * 100)
}

function paceTSS(activity: StravaActivity, thresholdPace: number): number {
  if (!activity.average_speed || thresholdPace <= 0) return 0
  const adjustedSpeed = gradeAdjustedSpeed(activity)
  const intensityFactor = clamp(adjustedSpeed / thresholdPace, 0, MAX_INTENSITY_FACTOR)
  const hours = activity.moving_time / 3600
  return Math.round(hours * intensityFactor * intensityFactor * 100)
}

// Training load as intervals.icu computed it (`icu_training_load`, stored in
// `suffer_score`). It comes from the full power/HR stream, so it beats anything
// derivable from ride averages — a hilly ride and a steady one with the same
// average watts get the loads their normalized power deserves.
//
// Only intervals.icu-sourced activities carry it. Strava writes its own Relative
// Effort into the same field on an unrelated scale, so the id check is what
// keeps the two out of one number.
function reportedTrainingLoad(activity: StravaActivity): number | null {
  if (!isIntervalsActivityId(activity.id)) return null
  const load = activity.suffer_score
  return load && load > 0 ? Math.round(load) : null
}

// The one training-load number for an activity — best available signal first.
// Every surface that shows load (activity list, plan, CTL/ATL) goes through
// here, so a ride reads the same everywhere.
export function calculateTSS(activity: StravaActivity, thresholds: TssThresholds): number {
  const sport = classifySport(activity)
  if (sport === 'other') return 0

  const reported = reportedTrainingLoad(activity)
  if (reported !== null) return reported

  if (sport === 'cycling') {
    if (activity.average_watts && thresholds.ftp > 0) return powerTSS(activity, thresholds.ftp)
    if (thresholds.cyclingLTHR) return hrTSS(activity, thresholds.cyclingLTHR)
    return 0
  }

  if (sport === 'running') {
    if (thresholds.runningThresholdPace && activity.average_speed > 0) {
      return paceTSS(activity, thresholds.runningThresholdPace)
    }
    if (thresholds.runningLTHR) return hrTSS(activity, thresholds.runningLTHR)
    return 0
  }

  return 0
}


function topNAverage(values: number[], n: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => b - a)
  const top = sorted.slice(0, Math.min(n, sorted.length))
  return top.reduce((s, v) => s + v, 0) / top.length
}

export function deriveThresholds(
  activities: StravaActivity[],
  athlete: { ftp: number; maxHR: number; restingHR: number },
  now: Date = new Date()
): ThresholdResult {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - DERIVATION_WINDOW_DAYS)

  const recent = activities.filter((a) => {
    const d = new Date(a.start_date_local || a.start_date)
    return d >= cutoff && d <= now
  })

  const longRides = recent.filter(
    (a) =>
      classifySport(a) === 'cycling' &&
      a.moving_time >= MIN_RIDE_DURATION_S &&
      typeof a.average_heartrate === 'number'
  )
  const longRuns = recent.filter(
    (a) =>
      classifySport(a) === 'running' &&
      a.moving_time >= MIN_RUN_DURATION_S &&
      typeof a.average_heartrate === 'number'
  )

  let cyclingLTHR: number | null = null
  let cyclingSource: ThresholdSource = 'unavailable'
  if (longRides.length >= MIN_QUALIFYING_EFFORTS) {
    const avg = topNAverage(longRides.map((a) => a.average_heartrate!), TOP_EFFORTS)
    if (avg !== null) {
      cyclingLTHR = Math.round(avg)
      cyclingSource = 'derived'
    }
  }
  if (cyclingLTHR === null && athlete.maxHR > 0) {
    cyclingLTHR = Math.round(athlete.maxHR * 0.85)
    cyclingSource = 'estimated'
  }

  let runningLTHR: number | null = null
  let runningSource: ThresholdSource = 'unavailable'
  if (longRuns.length >= MIN_QUALIFYING_EFFORTS) {
    const avg = topNAverage(longRuns.map((a) => a.average_heartrate!), TOP_EFFORTS)
    if (avg !== null) {
      runningLTHR = Math.round(avg)
      runningSource = 'derived'
    }
  }
  if (runningLTHR === null && athlete.maxHR > 0) {
    runningLTHR = Math.round(athlete.maxHR * 0.89)
    runningSource = 'estimated'
  }

  const longRunsForPace = recent.filter(
    (a) => classifySport(a) === 'running' && a.moving_time >= MIN_RUN_DURATION_S && a.average_speed > 0
  )
  let runningThresholdPace: number | null = null
  let paceSource: ThresholdSource = 'unavailable'
  if (longRunsForPace.length >= MIN_QUALIFYING_EFFORTS) {
    const avg = topNAverage(longRunsForPace.map(gradeAdjustedSpeed), TOP_EFFORTS)
    if (avg !== null) {
      runningThresholdPace = avg
      paceSource = 'derived'
    }
  }

  return {
    thresholds: {
      ftp: athlete.ftp,
      cyclingLTHR,
      runningLTHR,
      runningThresholdPace,
      maxHR: athlete.maxHR,
      restingHR: athlete.restingHR,
    },
    sources: {
      cyclingLTHR: cyclingSource,
      runningLTHR: runningSource,
      runningThresholdPace: paceSource,
    },
  }
}
