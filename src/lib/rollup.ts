import { type StravaActivity } from './strava'

/** Several activities combined into one summary. */
export interface ActivityRollup {
  count: number
  distance: number
  movingTime: number
  elapsedTime: number
  elevation: number
  maxSpeed: number
  /** Duration-weighted — see rollup() on why these aren't plain means. */
  avgWatts?: number
  normalizedWatts?: number
  avgHeartrate?: number
  avgCadence?: number
  maxWatts?: number
  maxHeartrate?: number
  /** Summed: training load is additive, unlike the intensity averages. */
  trainingLoad?: number
  kilojoules?: number
  earliest: StravaActivity
  latest: StravaActivity
  /** The type most members share. */
  predominantType: string
}

/** Duration-weighted mean of `pick` over the members that have that value.
 * Undefined when none of them do. */
function weightedMean(
  activities: StravaActivity[],
  pick: (a: StravaActivity) => number | undefined
): number | undefined {
  let weighted = 0
  let time = 0
  for (const a of activities) {
    const v = pick(a)
    if (v == null || a.moving_time <= 0) continue
    weighted += v * a.moving_time
    time += a.moving_time
  }
  return time > 0 ? weighted / time : undefined
}

function maxOf(
  activities: StravaActivity[],
  pick: (a: StravaActivity) => number | undefined
): number | undefined {
  const values = activities.map(pick).filter((v): v is number => v != null)
  return values.length > 0 ? Math.max(...values) : undefined
}

function sumOf(
  activities: StravaActivity[],
  pick: (a: StravaActivity) => number | undefined
): number | undefined {
  const values = activities.map(pick).filter((v): v is number => v != null)
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined
}

/**
 * Combine several activities into one summary.
 *
 * Intensity averages are **duration-weighted**. A 20-minute opener and a
 * 3-hour endurance ride are not two equal samples of "how hard was this" —
 * an unweighted mean lets the short hard effort drag the average up by as much
 * as the long ride that actually accumulated the load. This used to be
 * implemented three times: the plan page weighted by duration while the
 * activity list and the group merge took plain means, so the same group showed
 * different "avg power" on different pages.
 *
 * Totals (distance, time, elevation, load, kilojoules) sum; maxima take the max.
 */
export function rollup(activities: StravaActivity[]): ActivityRollup | null {
  if (activities.length === 0) return null

  const byDate = [...activities].sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
  )

  const typeCounts = new Map<string, number>()
  for (const a of activities) typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1)
  const predominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

  return {
    count: activities.length,
    distance: activities.reduce((s, a) => s + a.distance, 0),
    movingTime: activities.reduce((s, a) => s + a.moving_time, 0),
    elapsedTime: activities.reduce((s, a) => s + a.elapsed_time, 0),
    elevation: activities.reduce((s, a) => s + a.total_elevation_gain, 0),
    maxSpeed: Math.max(...activities.map((a) => a.max_speed)),
    avgWatts: weightedMean(activities, (a) => a.average_watts),
    normalizedWatts: weightedMean(activities, (a) => a.weighted_average_watts),
    avgHeartrate: weightedMean(activities, (a) => a.average_heartrate),
    avgCadence: weightedMean(activities, (a) => a.average_cadence),
    maxWatts: maxOf(activities, (a) => a.max_watts),
    maxHeartrate: maxOf(activities, (a) => a.max_heartrate),
    trainingLoad: sumOf(activities, (a) => a.suffer_score),
    kilojoules: sumOf(activities, (a) => a.kilojoules),
    earliest: byDate[0],
    latest: byDate[byDate.length - 1],
    predominantType,
  }
}

/**
 * Present a rollup as a single synthetic activity, so grouped activities flow
 * through everything that already understands one activity — TSS, the fitness
 * curve, stats, the activity list.
 *
 * `id` is negative by convention so a synthetic row can never collide with a
 * real Strava or intervals.icu id.
 */
export function toSyntheticActivity(
  r: ActivityRollup,
  id: number,
  name: string
): StravaActivity {
  return {
    id,
    name,
    type: r.predominantType,
    sport_type: r.earliest.sport_type,
    start_date: r.earliest.start_date,
    start_date_local: r.earliest.start_date_local,
    distance: r.distance,
    moving_time: r.movingTime,
    elapsed_time: r.elapsedTime,
    total_elevation_gain: r.elevation,
    average_speed: r.movingTime > 0 ? r.distance / r.movingTime : 0,
    max_speed: r.maxSpeed,
    average_watts: r.avgWatts,
    max_watts: r.maxWatts,
    weighted_average_watts: r.normalizedWatts,
    average_heartrate: r.avgHeartrate,
    max_heartrate: r.maxHeartrate,
    average_cadence: r.avgCadence,
    suffer_score: r.trainingLoad,
    kilojoules: r.kilojoules,
  }
}
