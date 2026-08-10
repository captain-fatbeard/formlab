import {
  type StravaActivity,
  type ActivityDetailsJson,
  type StravaSplit,
  computePowerPerKm,
  computePowerCurve,
} from './strava'

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1'

// Activities synced from intervals.icu get this offset added to the numeric part
// of their id ('i164403937' -> 1000164403937). Keeps them clear of the Strava id
// range (5.6e8 .. ~2e10 in our cache) so both sources coexist in one table.
export const INTERVALS_ID_OFFSET = 1_000_000_000_000

export function isIntervalsActivityId(id: number): boolean {
  return id >= INTERVALS_ID_OFFSET
}

export function toIntervalsApiId(id: number): string {
  return `i${id - INTERVALS_ID_OFFSET}`
}

export function fromIntervalsApiId(apiId: string): number {
  return INTERVALS_ID_OFFSET + Number(apiId.replace(/^i/, ''))
}

export interface IntervalsActivity {
  id: string
  name: string
  type: string
  sub_type: string | null
  start_date: string
  start_date_local: string
  distance: number | null
  moving_time: number | null
  elapsed_time: number | null
  total_elevation_gain: number | null
  average_speed: number | null
  max_speed: number | null
  icu_average_watts: number | null
  icu_weighted_avg_watts: number | null
  icu_joules: number | null
  device_watts: boolean | null
  average_heartrate: number | null
  max_heartrate: number | null
  average_cadence: number | null
  icu_training_load: number | null
  icu_weight: number | null
  calories: number | null
  device_name: string | null
  description: string | null
  average_temp: number | null
  perceived_exertion: number | null
  icu_rpe: number | null
  trainer: boolean | null
  strava_id: string | null
  stream_types: string[] | null
}

async function intervalsGet<T>(apiKey: string, path: string): Promise<T> {
  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64')
  const response = await fetch(`${INTERVALS_API_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  })

  if (!response.ok) {
    throw new Error(`intervals.icu request failed (${response.status}): ${path}`)
  }

  return response.json()
}

export async function listIntervalsActivities(
  apiKey: string,
  oldest?: string
): Promise<IntervalsActivity[]> {
  const newest = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  const from = (oldest ?? '2010-01-01').slice(0, 10)
  return intervalsGet(apiKey, `/athlete/0/activities?oldest=${from}&newest=${newest}`)
}

export async function getIntervalsActivity(
  apiKey: string,
  apiId: string
): Promise<IntervalsActivity> {
  return intervalsGet(apiKey, `/activity/${apiId}`)
}

interface IntervalsStream {
  type: string
  data: number[]
  // For latlng streams, `data` holds latitudes and `data2` holds longitudes
  data2?: number[]
}

// Returns numeric streams keyed by type, plus latlng as [lat, lng] pairs.
export async function getIntervalsStreams(
  apiKey: string,
  apiId: string,
  types: string[]
): Promise<{ numeric: Record<string, number[]>; latlng?: Array<[number, number]> }> {
  let streams: IntervalsStream[]
  try {
    streams = await intervalsGet(apiKey, `/activity/${apiId}/streams?types=${types.join(',')}`)
  } catch {
    return { numeric: {} }
  }

  const numeric: Record<string, number[]> = {}
  let latlng: Array<[number, number]> | undefined
  for (const stream of Array.isArray(streams) ? streams : []) {
    if (stream.type === 'latlng') {
      const lats = stream.data ?? []
      const lngs = stream.data2 ?? []
      const n = Math.min(lats.length, lngs.length)
      latlng = []
      for (let i = 0; i < n; i++) {
        if (lats[i] != null && lngs[i] != null) latlng.push([lats[i], lngs[i]])
      }
    } else {
      numeric[stream.type] = stream.data
    }
  }
  return { numeric, latlng }
}

export function mapIntervalsActivity(a: IntervalsActivity): StravaActivity {
  const id = a.strava_id ? Number(a.strava_id) : fromIntervalsApiId(a.id)
  return {
    id,
    name: a.name,
    type: a.type,
    sport_type: a.sub_type ?? a.type,
    start_date: a.start_date,
    start_date_local: a.start_date_local,
    distance: a.distance ?? 0,
    moving_time: a.moving_time ?? 0,
    elapsed_time: a.elapsed_time ?? a.moving_time ?? 0,
    total_elevation_gain: a.total_elevation_gain ?? 0,
    average_speed: a.average_speed ?? 0,
    max_speed: a.max_speed ?? 0,
    average_watts: a.icu_average_watts ?? undefined,
    weighted_average_watts: a.icu_weighted_avg_watts ?? undefined,
    average_heartrate: a.average_heartrate ?? undefined,
    max_heartrate: a.max_heartrate ?? undefined,
    average_cadence: a.average_cadence ?? undefined,
    suffer_score: a.icu_training_load ?? undefined,
    kilojoules: a.icu_joules != null ? a.icu_joules / 1000 : undefined,
  }
}

// Two activities of the same type starting within this window are considered the
// same workout recorded by two sources (Strava cache vs intervals.icu backfill).
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000

// The two sources don't always agree on an activity's type: indoor rides from
// 2020 come back from intervals.icu as 'Ride' but were cached from Strava as
// 'VirtualRide'. Comparing raw types lets that disagreement defeat the
// duplicate check entirely, so the same workout lands twice. Collapse types
// into families first — distinct enough that a ride is never mistaken for a
// run, loose enough that a naming difference between sources can't slip past.
const TYPE_FAMILIES: Record<string, string> = {
  Ride: 'ride',
  VirtualRide: 'ride',
  EBikeRide: 'ride',
  GravelRide: 'ride',
  MountainBikeRide: 'ride',
  Handcycle: 'ride',
  Run: 'run',
  VirtualRun: 'run',
  TrailRun: 'run',
  Walk: 'walk',
  Hike: 'walk',
  Swim: 'swim',
  VirtualSwim: 'swim',
}

export function activityTypeFamily(type: string): string {
  return TYPE_FAMILIES[type] ?? type
}

export function dedupeAgainstExisting(
  fetched: StravaActivity[],
  existing: StravaActivity[]
): StravaActivity[] {
  const existingIds = new Set(existing.map((a) => a.id))
  const existingByType = new Map<string, number[]>()
  for (const a of existing) {
    const family = activityTypeFamily(a.type)
    const starts = existingByType.get(family) ?? []
    starts.push(new Date(a.start_date).getTime())
    existingByType.set(family, starts)
  }

  return fetched.filter((a) => {
    if (existingIds.has(a.id)) return true // same id upserts in place
    const starts = existingByType.get(activityTypeFamily(a.type))
    if (!starts) return true
    const start = new Date(a.start_date).getTime()
    return !starts.some((s) => Math.abs(s - start) < DUPLICATE_WINDOW_MS)
  })
}

// Self-heal: ids of intervals.icu-sourced activities that duplicate a
// Strava-era activity (same type, started within the duplicate window).
// These can appear if a sync ever ran against an incomplete view of the
// cache; the Strava copy wins since it carries details and power estimates.
export function findIntervalsDuplicateIds(activities: StravaActivity[]): number[] {
  const stravaEra = activities.filter((a) => !isIntervalsActivityId(a.id))
  const intervalsEra = activities.filter((a) => isIntervalsActivityId(a.id))
  if (stravaEra.length === 0 || intervalsEra.length === 0) return []

  const kept = new Set(dedupeAgainstExisting(intervalsEra, stravaEra).map((a) => a.id))
  return intervalsEra.filter((a) => !kept.has(a.id)).map((a) => a.id)
}

// Google encoded polyline (precision 5), as used by Strava's summary_polyline.
export function encodePolyline(points: Array<[number, number]>): string {
  let result = ''
  let prevLat = 0
  let prevLng = 0

  const encodeValue = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    let chunk = ''
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    return chunk + String.fromCharCode(v + 63)
  }

  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5)
    const lngE5 = Math.round(lng * 1e5)
    result += encodeValue(latE5 - prevLat) + encodeValue(lngE5 - prevLng)
    prevLat = latE5
    prevLng = lngE5
  }
  return result
}

// Per-km splits from the raw streams, matching the shape Strava provided.
export function computeSplitsFromStreams(
  timeStream: number[],
  distanceStream: number[],
  heartrateStream?: number[],
  altitudeStream?: number[]
): StravaSplit[] {
  if (!timeStream?.length || !distanceStream?.length) return []

  const n = Math.min(timeStream.length, distanceStream.length)
  const splits: StravaSplit[] = []
  let kmBoundary = 1000
  let splitStartIdx = 0

  const pushSplit = (startIdx: number, endIdx: number, split: number, distance: number) => {
    const movingTime = timeStream[endIdx] - timeStream[startIdx]
    if (movingTime <= 0 || distance < 100) return

    let hrSum = 0
    let hrCount = 0
    if (heartrateStream) {
      for (let i = startIdx; i <= endIdx && i < heartrateStream.length; i++) {
        if (heartrateStream[i] > 0) {
          hrSum += heartrateStream[i]
          hrCount++
        }
      }
    }

    const elevationDiff =
      altitudeStream && altitudeStream.length > endIdx
        ? Math.round((altitudeStream[endIdx] - altitudeStream[startIdx]) * 10) / 10
        : 0

    splits.push({
      distance,
      elapsed_time: movingTime,
      moving_time: movingTime,
      elevation_difference: elevationDiff,
      split,
      average_speed: distance / movingTime,
      average_heartrate: hrCount > 0 ? hrSum / hrCount : undefined,
      pace_zone: 0,
    })
  }

  for (let i = 0; i < n; i++) {
    if (distanceStream[i] >= kmBoundary) {
      pushSplit(splitStartIdx, i, splits.length + 1, distanceStream[i] - (splits.length * 1000))
      splitStartIdx = i
      kmBoundary += 1000
    }
  }

  // Final partial split
  const lastDistance = distanceStream[n - 1] - splits.length * 1000
  if (splitStartIdx < n - 1 && lastDistance > 100) {
    pushSplit(splitStartIdx, n - 1, splits.length + 1, lastDistance)
  }

  return splits
}

// --- Physics-based power estimation (for rides without a power meter) ---
//
// Same approach as Strava's estimated power: at each sample, the power needed
// to overcome rolling resistance, air drag and gravity on the gradient. No
// wind data exists, so assume still air — accurate on average, off in strong
// head/tailwinds. Acceleration is deliberately ignored: GPS speed derivatives
// are noise-dominated and Strava's estimates (the baseline this replaces,
// ~150W on the user's regular commute) exclude it too.
const GRAVITY = 9.81 // m/s²
const AIR_DENSITY = 1.226 // kg/m³ at sea level
const CDA = 0.32 // m² — road bike, hands on hoods
const CRR = 0.005 // rolling resistance, asphalt
const BIKE_WEIGHT_KG = 9 // bike + bottles + kit
const DRIVETRAIN_EFFICIENCY = 0.975
const GRADE_WINDOW_M = 30 // smooth barometric altitude over this distance
const MOVING_SPEED_MS = 0.5

export function estimatePowerStream(
  timeStream: number[],
  velocityStream: number[],
  distanceStream: number[],
  altitudeStream: number[],
  riderWeightKg: number
): number[] {
  const n = Math.min(
    timeStream.length,
    velocityStream.length,
    distanceStream.length,
    altitudeStream.length
  )
  if (n < 2) return []

  const mass = riderWeightKg + BIKE_WEIGHT_KG
  const watts = new Array<number>(n).fill(0)

  // Grade from altitude over a trailing distance window to denoise barometric
  // jitter (per-sample altitude deltas are mostly noise).
  let gradeStartIdx = 0

  for (let i = 1; i < n; i++) {
    const dt = timeStream[i] - timeStream[i - 1]
    if (dt <= 0 || dt > 10) continue // recording pause

    const v = velocityStream[i]
    if (!v || v < MOVING_SPEED_MS) continue

    while (
      gradeStartIdx < i - 1 &&
      distanceStream[i] - distanceStream[gradeStartIdx + 1] >= GRADE_WINDOW_M
    ) {
      gradeStartIdx++
    }
    const dDist = distanceStream[i] - distanceStream[gradeStartIdx]
    const dAlt = altitudeStream[i] - altitudeStream[gradeStartIdx]
    const grade = dDist > 1 ? Math.max(-0.25, Math.min(0.25, dAlt / dDist)) : 0

    const rolling = CRR * mass * GRAVITY * v
    const gravity = mass * GRAVITY * grade * v
    const aero = 0.5 * AIR_DENSITY * CDA * v * v * v

    const p = (rolling + gravity + aero) / DRIVETRAIN_EFFICIENCY
    watts[i] = Math.max(0, Math.min(1500, p))
  }

  // Light smoothing (5-sample moving average) to tame accel/grade noise.
  const smoothed = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      sum += watts[j]
      count++
    }
    smoothed[i] = Math.round(sum / count)
  }
  return smoothed
}

// Average power over moving samples (coasting counts as 0W, stops excluded).
export function averageMovingPower(
  wattsStream: number[],
  velocityStream: number[]
): number {
  let sum = 0
  let count = 0
  const n = Math.min(wattsStream.length, velocityStream.length)
  for (let i = 0; i < n; i++) {
    if (velocityStream[i] >= MOVING_SPEED_MS) {
      sum += wattsStream[i]
      count++
    }
  }
  return count > 0 ? Math.round(sum / count) : 0
}

// Keep at most `max` points, always including the last one, so encoded
// polylines stay summary-sized like Strava's were.
function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points
  const step = Math.ceil(points.length / max)
  const sampled = points.filter((_, i) => i % step === 0)
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1])
  }
  return sampled
}

export function buildDetailsFromIntervals(
  activity: IntervalsActivity,
  streams: { numeric: Record<string, number[]>; latlng?: Array<[number, number]> },
  riderWeightKg?: number
): ActivityDetailsJson {
  const { numeric, latlng } = streams

  let powerPerKm: number[] | undefined
  let powerCurve: Record<number, number> | undefined
  let powerEstimated: boolean | undefined
  let estimatedAvgWatts: number | undefined

  if (numeric.watts?.length) {
    if (numeric.distance?.length) {
      powerPerKm = computePowerPerKm(numeric.distance, numeric.watts)
    }
    if (numeric.time?.length) {
      powerCurve = computePowerCurve(numeric.time, numeric.watts)
    }
  } else if (
    activity.type === 'Ride' && // outdoor rides only; virtual rides always have watts
    numeric.time?.length &&
    numeric.velocity_smooth?.length &&
    numeric.distance?.length &&
    numeric.altitude?.length
  ) {
    const weight = activity.icu_weight ?? riderWeightKg ?? 75
    const estimated = estimatePowerStream(
      numeric.time,
      numeric.velocity_smooth,
      numeric.distance,
      numeric.altitude,
      weight
    )
    if (estimated.length) {
      powerEstimated = true
      estimatedAvgWatts = averageMovingPower(estimated, numeric.velocity_smooth)
      powerPerKm = computePowerPerKm(numeric.distance, estimated)
      // Deliberately no power_curve and no normalized power: records,
      // power-duration peaks and NP stay real-meter only, matching how
      // Strava treated estimated rides.
    }
  }

  return {
    calories: activity.calories ?? 0,
    device_name: activity.device_name ?? '',
    description: activity.description || null,
    workout_type: null,
    average_temp: activity.average_temp ?? undefined,
    perceived_exertion: activity.perceived_exertion ?? activity.icu_rpe ?? null,
    achievement_count: 0,
    kudos_count: 0,
    comment_count: 0,
    gear_name: null,
    segment_efforts: [],
    splits_metric: computeSplitsFromStreams(
      numeric.time,
      numeric.distance,
      numeric.heartrate,
      numeric.altitude
    ),
    laps: [],
    best_efforts: [],
    summary_polyline: latlng?.length ? encodePolyline(downsample(latlng, 500)) : null,
    photo_url: null,
    power_estimated: powerEstimated,
    estimated_avg_watts: estimatedAvgWatts,
    power_per_km: powerPerKm,
    power_curve: powerCurve,
  }
}
