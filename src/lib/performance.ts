import { startOfWeek, addWeeks } from 'date-fns'
import { type StravaActivity } from './strava'
import { zoneColors, formatDateShort } from './chart-theme'
import { calculateTSS as calculateTSSWithThresholds, classifySport, isRide, isRun, type TssThresholds } from './tss'

// FTP entry with effective date — FTP applies from this date until the next entry
export interface FtpHistoryEntry {
  date: string // 'YYYY-MM-DD'
  ftp: number
}

// Multiplier that converts a sustained effort of a given duration (minutes) into
// an FTP estimate, following the standard power-duration curve. Efforts shorter
// than ~60 min can be held above FTP (multiplier < 1); longer efforts fall below
// it (multiplier > 1). Anchored so a 20-min effort gives the classic
// FTP = 0.95 × power. Clamped to [20, 240] min where the model is reliable.
function ftpMultiplierForDuration(minutes: number): number {
  // [duration (min), power × multiplier = FTP]
  const curve: [number, number][] = [
    [20, 0.95],
    [30, 0.98],
    [40, 0.99],
    [60, 1.0],
    [90, 1.05],
    [120, 1.1],
    [180, 1.18],
    [240, 1.25],
  ]
  const m = Math.max(curve[0][0], Math.min(curve[curve.length - 1][0], minutes))
  for (let i = 0; i < curve.length - 1; i++) {
    const [d0, f0] = curve[i]
    const [d1, f1] = curve[i + 1]
    if (m <= d1) {
      const t = (m - d0) / (d1 - d0)
      return f0 + t * (f1 - f0)
    }
  }
  return curve[curve.length - 1][1]
}

// FTP estimate from a single ride's sustained power. Prefers Normalized Power
// (weighted_average_watts) over raw average, since it better reflects the
// metabolic cost of variable-intensity rides, then adjusts for duration.
function ftpFromRide(a: StravaActivity): number {
  const power = a.weighted_average_watts || a.average_watts || 0
  return power * ftpMultiplierForDuration(a.moving_time / 60)
}

// Estimate FTP from activities using a duration-adjusted power-duration model.
// Takes the best estimate across all qualifying rides — non-maximal rides simply
// produce lower estimates and don't dominate.
export function estimateFTP(activities: StravaActivity[]): number | null {
  const ridesWithPower = activities.filter(
    (a) => isRide(a) && (a.average_watts || a.weighted_average_watts)
  )

  if (ridesWithPower.length === 0) return null

  // Rides >= 20 minutes are where the duration model is reliable
  const longRides = ridesWithPower.filter((a) => a.moving_time >= 1200)
  if (longRides.length > 0) {
    return Math.round(Math.max(...longRides.map(ftpFromRide)))
  }

  // Fall back to Normalized Power at the 20-min anchor for shorter rides only
  const withNP = ridesWithPower.filter((a) => a.weighted_average_watts)
  if (withNP.length > 0) {
    const bestNP = Math.max(...withNP.map((a) => a.weighted_average_watts || 0))
    return Math.round(bestNP * 0.95)
  }
  return null
}

// Estimate FTP at different points in time using a rolling 90-day window.
// Uses the same duration-adjusted power-duration model as estimateFTP.
// Returns entries sorted by date ascending
export function estimateFTPHistory(activities: StravaActivity[]): FtpHistoryEntry[] {
  const ridesWithPower = activities
    .filter((a) => isRide(a) && (a.average_watts || a.weighted_average_watts) && a.moving_time >= 1200)
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local))

  if (ridesWithPower.length === 0) return []

  // Best duration-adjusted FTP estimate per month
  const monthlyBest: Record<string, number> = {}
  ridesWithPower.forEach((a) => {
    const month = a.start_date_local.substring(0, 7) // 'YYYY-MM'
    monthlyBest[month] = Math.max(monthlyBest[month] || 0, ftpFromRide(a))
  })

  // Create an FTP entry per month based on rolling 90-day best average power
  const months = Object.keys(monthlyBest).sort()
  const result: FtpHistoryEntry[] = []

  for (const month of months) {
    // Look back 3 months for best power
    const monthDate = new Date(month + '-01')
    let best = 0
    for (const [m, power] of Object.entries(monthlyBest)) {
      const mDate = new Date(m + '-01')
      const diffMs = monthDate.getTime() - mDate.getTime()
      const diffDays = diffMs / (1000 * 60 * 60 * 24)
      if (diffDays >= 0 && diffDays <= 90) {
        best = Math.max(best, power)
      }
    }

    const ftp = Math.round(best)
    // Only add if different from last entry
    if (result.length === 0 || result[result.length - 1].ftp !== ftp) {
      result.push({ date: month + '-01', ftp })
    }
  }

  return result
}

// Get the FTP value for a given date from FTP history
export function getFTPForDate(date: string, ftpHistory: FtpHistoryEntry[]): number {
  // ftpHistory must be sorted by date ascending
  let ftp = ftpHistory[0]?.ftp || 0
  for (const entry of ftpHistory) {
    if (entry.date <= date) {
      ftp = entry.ftp
    } else {
      break
    }
  }
  return ftp
}

// Power zones based on FTP
export interface PowerZone {
  name: string
  min: number
  max: number
  color: string
}

export function getPowerZones(ftp: number): PowerZone[] {
  return [
    { name: 'Recovery', min: 0, max: Math.round(ftp * 0.55), color: zoneColors[0] },
    { name: 'Endurance', min: Math.round(ftp * 0.55), max: Math.round(ftp * 0.75), color: zoneColors[1] },
    { name: 'Tempo', min: Math.round(ftp * 0.75), max: Math.round(ftp * 0.9), color: zoneColors[2] },
    { name: 'Threshold', min: Math.round(ftp * 0.9), max: Math.round(ftp * 1.05), color: zoneColors[3] },
    { name: 'VO2max', min: Math.round(ftp * 1.05), max: Math.round(ftp * 1.2), color: zoneColors[4] },
    { name: 'Anaerobic', min: Math.round(ftp * 1.2), max: Math.round(ftp * 1.5), color: zoneColors[5] },
    { name: 'Neuromuscular', min: Math.round(ftp * 1.5), max: 9999, color: zoneColors[6] },
  ]
}

export function getZoneForPower(power: number, ftp: number): PowerZone {
  const zones = getPowerZones(ftp)
  return zones.find((z) => power >= z.min && power < z.max) || zones[0]
}

// Calculate zone distribution from activities
export function calculateZoneDistribution(
  activities: StravaActivity[],
  ftp: number
): { zone: string; time: number; percentage: number; color: string }[] {
  const zones = getPowerZones(ftp)
  const zoneTime: Record<string, number> = {}

  zones.forEach((z) => (zoneTime[z.name] = 0))

  const ridesWithPower = activities.filter(
    (a) => isRide(a) && a.average_watts
  )

  ridesWithPower.forEach((activity) => {
    const zone = getZoneForPower(activity.average_watts || 0, ftp)
    zoneTime[zone.name] += activity.moving_time
  })

  const totalTime = Object.values(zoneTime).reduce((sum, t) => sum + t, 0)

  return zones.map((z) => ({
    zone: z.name,
    time: zoneTime[z.name],
    percentage: totalTime > 0 ? Math.round((zoneTime[z.name] / totalTime) * 100) : 0,
    color: z.color,
  })).filter((z) => z.time > 0)
}

// Re-exported from ./tss for convenience — see that module for the full
// sport-aware TSS pipeline (power, hrTSS, rTSS).
export { calculateTSS } from './tss'

// Calculate fitness (CTL), fatigue (ATL), and form (TSB)
export interface FitnessData {
  date: string
  ctl: number // Chronic Training Load (fitness)
  atl: number // Acute Training Load (fatigue)
  tsb: number // Training Stress Balance (form)
  tss: number // Daily TSS
  ftp: number // FTP used for this date
}

export function calculateFitnessOverTime(
  activities: StravaActivity[],
  ftpHistory: FtpHistoryEntry[],
  thresholds?: TssThresholds
): FitnessData[] {
  const trackedActivities = activities.filter((a) => {
    const sport = classifySport(a)
    if (sport === 'other') return false
    // A reported intervals.icu load is enough on its own — calculateTSS prefers
    // it over the averages anyway.
    if (a.suffer_score) return true
    if (sport === 'cycling') return Boolean(a.average_watts || a.average_heartrate)
    return a.average_speed > 0 || Boolean(a.average_heartrate)
  })

  if (trackedActivities.length === 0 || ftpHistory.length === 0) return []

  const dailyActivities: Record<string, StravaActivity[]> = {}
  trackedActivities.forEach((activity) => {
    const date = activity.start_date_local.split('T')[0]
    if (!dailyActivities[date]) dailyActivities[date] = []
    dailyActivities[date].push(activity)
  })

  // Start from earliest activity to build up CTL/ATL accurately
  const earliest = trackedActivities
    .map((a) => new Date(a.start_date_local))
    .reduce((min, d) => (d < min ? d : min))
  earliest.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const sortedFtp = [...ftpHistory].sort((a, b) => a.date.localeCompare(b.date))

  const result: FitnessData[] = []
  let ctl = 0
  let atl = 0

  // Iterate through each day from earliest activity to today (inclusive)
  for (let d = new Date(earliest); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const ftp = getFTPForDate(dateStr, sortedFtp)

    let tss = 0
    if (dailyActivities[dateStr]) {
      const dayThresholds: TssThresholds = thresholds
        ? { ...thresholds, ftp }
        : { ftp, cyclingLTHR: null, runningLTHR: null, runningThresholdPace: null, maxHR: 0, restingHR: 0 }
      for (const activity of dailyActivities[dateStr]) {
        tss += calculateTSSWithThresholds(activity, dayThresholds)
      }
    }

    // Exponential weighted moving averages
    ctl = ctl + (tss - ctl) / 42 // 42-day time constant
    atl = atl + (tss - atl) / 7 // 7-day time constant
    const tsb = ctl - atl

    result.push({
      date: dateStr,
      // Keep one decimal: CTL moves by at most ctl/42 (~1.3) per day, so integer
      // rounding makes a smooth ~1.3 decay look like a 2-point overnight jump.
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      tss,
      ftp,
    })
  }

  return result
}

// Personal Records
export interface PersonalRecord {
  type: string
  value: number
  unit: string
  activity: StravaActivity
  date: string
}

export function calculatePersonalRecords(activities: StravaActivity[]): PersonalRecord[] {
  const records: PersonalRecord[] = []

  const rides = activities.filter((a) => isRide(a))
  const runs = activities.filter((a) => isRun(a))

  // Longest ride
  if (rides.length > 0) {
    const longest = rides.reduce((max, a) => (a.distance > max.distance ? a : max))
    records.push({
      type: 'Longest Ride',
      value: Math.round(longest.distance / 1000),
      unit: 'km',
      activity: longest,
      date: longest.start_date_local,
    })
  }

  // Max power
  const ridesWithPower = rides.filter((a) => a.max_watts)
  if (ridesWithPower.length > 0) {
    const maxPower = ridesWithPower.reduce((max, a) =>
      (a.max_watts || 0) > (max.max_watts || 0) ? a : max
    )
    records.push({
      type: 'Max Power',
      value: maxPower.max_watts || 0,
      unit: 'W',
      activity: maxPower,
      date: maxPower.start_date_local,
    })
  }

  // Best avg power (20+ min)
  const longRidesWithPower = rides.filter((a) => a.average_watts && a.moving_time >= 1200)
  if (longRidesWithPower.length > 0) {
    const bestAvg = longRidesWithPower.reduce((max, a) =>
      (a.average_watts || 0) > (max.average_watts || 0) ? a : max
    )
    records.push({
      type: 'Best Avg Power (20m+)',
      value: Math.round(bestAvg.average_watts || 0),
      unit: 'W',
      activity: bestAvg,
      date: bestAvg.start_date_local,
    })
  }

  // Most elevation
  if (rides.length > 0) {
    const mostClimb = rides.reduce((max, a) =>
      a.total_elevation_gain > max.total_elevation_gain ? a : max
    )
    records.push({
      type: 'Most Climbing',
      value: Math.round(mostClimb.total_elevation_gain),
      unit: 'm',
      activity: mostClimb,
      date: mostClimb.start_date_local,
    })
  }

  // Fastest avg speed (ride). Cap average_speed to filter out corrupt data
  // (e.g. an imported ride logging 45km in 5s → ~9000 m/s). 25 m/s ≈ 90 km/h,
  // beyond any plausible 20km+ ride average.
  const fastRides = rides.filter(
    (a) => a.distance >= 20000 && a.average_speed > 0 && a.average_speed <= 25
  )
  if (fastRides.length > 0) {
    const fastest = fastRides.reduce((max, a) =>
      a.average_speed > max.average_speed ? a : max
    )
    records.push({
      type: 'Fastest Ride (20km+)',
      value: Math.round(fastest.average_speed * 3.6 * 10) / 10,
      unit: 'km/h',
      activity: fastest,
      date: fastest.start_date_local,
    })
  }

  // Longest run
  if (runs.length > 0) {
    const longestRun = runs.reduce((max, a) => (a.distance > max.distance ? a : max))
    records.push({
      type: 'Longest Run',
      value: Math.round(longestRun.distance / 100) / 10,
      unit: 'km',
      activity: longestRun,
      date: longestRun.start_date_local,
    })
  }

  // Best run pace (5km+). Cap average_speed to filter out bad GPS data:
  // 7 m/s ≈ 2:23/km (faster than world record), 1.5 m/s ≈ 11:07/km (slower is walking).
  const longRuns = runs.filter(
    (a) => a.distance >= 5000 && a.average_speed >= 1.5 && a.average_speed <= 7
  )
  if (longRuns.length > 0) {
    const fastestRun = longRuns.reduce((max, a) =>
      a.average_speed > max.average_speed ? a : max
    )
    const paceSecsPerKm = 1000 / fastestRun.average_speed
    const paceMin = Math.floor(paceSecsPerKm / 60)
    const paceSec = Math.round(paceSecsPerKm % 60)
    records.push({
      type: 'Best Pace (5km+)',
      value: paceMin + paceSec / 100,
      unit: `${paceMin}:${paceSec.toString().padStart(2, '0')}/km`,
      activity: fastestRun,
      date: fastestRun.start_date_local,
    })
  }

  return records
}

// Advanced Metrics

// VO2max estimation from cycling power (ml/kg/min)
// Based on the relationship between power output and oxygen consumption
export function estimateVO2max(ftp: number, weight: number): number {
  if (!ftp || !weight) return 0
  // Formula: VO2max ≈ (10.8 * W/kg) + 7
  // This is based on the linear relationship between power and VO2
  const wattsPerKg = ftp / weight
  return Math.round((10.8 * wattsPerKg + 7) * 10) / 10
}

// Get VO2max category, graded against recreational (motionist) peers of the
// same age and gender rather than a fixed athletic scale. Anchored on the
// average/good values from vo2maxBenchmarks so the bands shift with age.
export function getVO2maxCategory(
  vo2max: number,
  age: number = 35,
  gender: 'male' | 'female' = 'male'
): string {
  const row = vo2maxBenchmarks[gender].find(([maxAge]) => age <= maxAge) || vo2maxBenchmarks[gender].at(-1)!
  const [, average, good] = row
  const spread = good - average // gap between the "average" and "good" peer

  if (vo2max >= good + spread) return 'Elite'
  if (vo2max >= good) return 'Excellent'
  if (vo2max >= average) return 'Good'
  if (vo2max >= average - spread) return 'Average'
  return 'Below Average'
}

// ==========================================
// Motionist (Average Recreational Exerciser) Benchmarks by Age
// ==========================================

// VO2max normative data (ml/kg/min) - based on ACSM guidelines
// Values represent the 50th percentile for recreationally active adults
const vo2maxBenchmarks: Record<'male' | 'female', [number, number, number][]> = {
  male: [
    // [maxAge, average, good]
    [29, 43, 49],
    [39, 41, 47],
    [49, 38, 44],
    [59, 35, 41],
    [69, 31, 37],
    [99, 28, 34],
  ],
  female: [
    [29, 37, 43],
    [39, 35, 41],
    [49, 32, 38],
    [59, 29, 35],
    [69, 26, 32],
    [99, 23, 29],
  ],
}

// Resting HR benchmarks by age (average active adult)
const restingHRBenchmarks: [number, number][] = [
  // [maxAge, avgRestingHR]
  [29, 72],
  [39, 73],
  [49, 74],
  [59, 75],
  [69, 73],
  [99, 73],
]

export interface MotionistBenchmarks {
  vo2max: number        // Average VO2max for age/gender
  vo2maxGood: number    // "Good" VO2max threshold
  maxHR: number         // Expected max HR (220 - age)
  restingHR: number     // Average resting HR
  wPerKg: number        // Average W/kg for recreational cyclist
  ftp: number           // Estimated average FTP (wPerKg * 75kg reference)
}

export function getMotionistBenchmarks(age: number, gender: 'male' | 'female'): MotionistBenchmarks {
  // VO2max
  const vo2Row = vo2maxBenchmarks[gender].find(([maxAge]) => age <= maxAge) || vo2maxBenchmarks[gender].at(-1)!
  const vo2max = vo2Row[1]
  const vo2maxGood = vo2Row[2]

  // Resting HR
  const hrRow = restingHRBenchmarks.find(([maxAge]) => age <= maxAge) || restingHRBenchmarks.at(-1)!
  const restingHR = hrRow[1]

  // Max HR (Tanaka formula: 208 - 0.7 * age, more accurate than 220 - age)
  const maxHR = Math.round(208 - 0.7 * age)

  // W/kg for recreational cyclist declines with age
  // ~2.5 at 25, declining ~0.05 per 5 years
  const wPerKg = Math.round((2.5 - (age - 25) * 0.01) * 100) / 100

  return {
    vo2max,
    vo2maxGood,
    maxHR,
    restingHR,
    wPerKg: Math.max(wPerKg, 1.5),
    ftp: Math.round(Math.max(wPerKg, 1.5) * 75),
  }
}

// Calculate age from birthday string (YYYY-MM-DD)
export function calculateAge(birthday: string | null, defaultAge: number = 35): number {
  if (!birthday) return defaultAge
  const birth = new Date(birthday)
  if (isNaN(birth.getTime())) return defaultAge
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

// ==========================================
// Auto-calculated Max HR & Resting HR
// ==========================================

export interface CalculatedHR {
  value: number
  source: 'observed' | 'estimated'
  activityCount: number
}

// Max HR: highest observed max_heartrate across all activities
// Fallback: Tanaka formula (208 - 0.7 × age)
export function calculateMaxHR(activities: StravaActivity[], age: number): CalculatedHR {
  const withMaxHR = activities.filter((a) => a.max_heartrate && a.max_heartrate > 0)

  if (withMaxHR.length > 0) {
    const observed = Math.max(...withMaxHR.map((a) => a.max_heartrate!))
    return { value: observed, source: 'observed', activityCount: withMaxHR.length }
  }

  // Tanaka formula fallback
  return { value: Math.round(208 - 0.7 * age), source: 'estimated', activityCount: 0 }
}

// Resting HR: 5th percentile of average_heartrate across activities (capped at 100 bpm)
// Requires minimum 5 activities with HR data
// Fallback: ACSM age-based estimate via getMotionistBenchmarks()
export function calculateRestingHR(
  activities: StravaActivity[],
  age: number,
  gender: 'male' | 'female'
): CalculatedHR {
  const withAvgHR = activities
    .filter((a) => a.average_heartrate && a.average_heartrate > 0 && a.average_heartrate <= 100)

  if (withAvgHR.length >= 5) {
    const sorted = withAvgHR.map((a) => a.average_heartrate!).sort((a, b) => a - b)
    const p5Index = Math.max(0, Math.floor(sorted.length * 0.05))
    return { value: Math.round(sorted[p5Index]), source: 'observed', activityCount: withAvgHR.length }
  }

  // Fall back to ACSM age-based estimate
  const benchmarks = getMotionistBenchmarks(age, gender)
  return { value: benchmarks.restingHR, source: 'estimated', activityCount: withAvgHR.length }
}

// Intensity Factor (IF) - how hard was the workout relative to FTP
export function calculateIF(normalizedPower: number, ftp: number): number {
  if (!normalizedPower || !ftp) return 0
  return Math.round((normalizedPower / ftp) * 100) / 100
}

// Variability Index (VI) - how steady was the effort (1.0 = perfectly steady)
export function calculateVI(normalizedPower: number, avgPower: number): number {
  if (!normalizedPower || !avgPower) return 0
  return Math.round((normalizedPower / avgPower) * 100) / 100
}

// VAM (Velocità Ascensionale Media) - climbing speed in m/hour
export function calculateVAM(elevationGain: number, movingTimeSeconds: number): number {
  if (!elevationGain || !movingTimeSeconds) return 0
  const hours = movingTimeSeconds / 3600
  return Math.round(elevationGain / hours)
}

// Efficiency Factor (EF) - aerobic efficiency (higher = fitter)
export function calculateEF(normalizedPower: number, avgHR: number): number {
  if (!normalizedPower || !avgHR) return 0
  return Math.round((normalizedPower / avgHR) * 100) / 100
}

// Power:HR ratio (watts per beat)
export function calculatePowerHR(avgPower: number, avgHR: number): number {
  if (!avgPower || !avgHR) return 0
  return Math.round((avgPower / avgHR) * 100) / 100
}

// Calculate average metrics across activities
export interface AdvancedMetrics {
  avgIF: number
  avgVI: number
  avgVAM: number
  avgEF: number
  avgPowerHR: number
  vo2max: number
  vo2maxCategory: string
  bestVAM: number
  bestEF: number
}

export function calculateAdvancedMetrics(
  activities: StravaActivity[],
  ftp: number,
  weight: number,
  age: number = 35,
  gender: 'male' | 'female' = 'male'
): AdvancedMetrics {
  const rides = activities.filter(
    (a) => isRide(a) && a.average_watts
  )

  if (rides.length === 0) {
    return {
      avgIF: 0,
      avgVI: 0,
      avgVAM: 0,
      avgEF: 0,
      avgPowerHR: 0,
      vo2max: 0,
      vo2maxCategory: '',
      bestVAM: 0,
      bestEF: 0,
    }
  }

  let totalIF = 0
  let totalVI = 0
  let totalVAM = 0
  let totalEF = 0
  let totalPowerHR = 0
  let countIF = 0
  let countVI = 0
  let countVAM = 0
  let countEF = 0
  let countPowerHR = 0
  let bestVAM = 0
  let bestEF = 0

  rides.forEach((ride) => {
    const np = ride.weighted_average_watts || ride.average_watts || 0
    const avgPower = ride.average_watts || 0
    const avgHR = ride.average_heartrate || 0

    // IF
    if (ftp > 0) {
      const rideIF = calculateIF(np, ftp)
      totalIF += rideIF
      countIF++
    }

    // VI
    if (np > 0 && avgPower > 0) {
      const rideVI = calculateVI(np, avgPower)
      totalVI += rideVI
      countVI++
    }

    // VAM (only for rides with significant climbing)
    if (ride.total_elevation_gain > 100) {
      const rideVAM = calculateVAM(ride.total_elevation_gain, ride.moving_time)
      totalVAM += rideVAM
      countVAM++
      if (rideVAM > bestVAM) bestVAM = rideVAM
    }

    // EF and Power:HR (need HR data)
    if (avgHR > 0 && np > 0) {
      const rideEF = calculateEF(np, avgHR)
      totalEF += rideEF
      countEF++
      if (rideEF > bestEF) bestEF = rideEF
    }

    if (avgHR > 0 && avgPower > 0) {
      const ridePowerHR = calculatePowerHR(avgPower, avgHR)
      totalPowerHR += ridePowerHR
      countPowerHR++
    }
  })

  const vo2max = estimateVO2max(ftp, weight)

  return {
    avgIF: countIF > 0 ? Math.round((totalIF / countIF) * 100) / 100 : 0,
    avgVI: countVI > 0 ? Math.round((totalVI / countVI) * 100) / 100 : 0,
    avgVAM: countVAM > 0 ? Math.round(totalVAM / countVAM) : 0,
    avgEF: countEF > 0 ? Math.round((totalEF / countEF) * 100) / 100 : 0,
    avgPowerHR: countPowerHR > 0 ? Math.round((totalPowerHR / countPowerHR) * 100) / 100 : 0,
    vo2max,
    vo2maxCategory: getVO2maxCategory(vo2max, age, gender),
    bestVAM,
    bestEF: Math.round(bestEF * 100) / 100,
  }
}

// Weekly training summary
export interface WeeklySummary {
  week: string
  rides: number
  runs: number
  totalDistance: number
  totalTime: number
  totalElevation: number
  totalTSS: number
  avgPower: number
}

export function calculateWeeklySummaries(
  activities: StravaActivity[],
  thresholds: TssThresholds,
  weeks: number = 12
): WeeklySummary[] {
  const summaries: WeeklySummary[] = []
  const now = new Date()
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 }) // Monday

  for (let w = 0; w < weeks; w++) {
    const weekStart = addWeeks(currentWeekStart, -w)
    const weekEnd = addWeeks(weekStart, 1)

    const weekActivities = activities.filter((a) => {
      const date = new Date(a.start_date)
      return date >= weekStart && date < weekEnd
    })

    const rides = weekActivities.filter((a) => isRide(a))
    const runs = weekActivities.filter((a) => isRun(a))

    const ridesWithPower = rides.filter((a) => a.average_watts)
    const avgPower =
      ridesWithPower.length > 0
        ? ridesWithPower.reduce((sum, a) => sum + (a.average_watts || 0), 0) / ridesWithPower.length
        : 0

    summaries.push({
      week: formatDateShort(weekStart),
      rides: rides.length,
      runs: runs.length,
      totalDistance: Math.round(weekActivities.reduce((sum, a) => sum + a.distance, 0) / 1000),
      totalTime: weekActivities.reduce((sum, a) => sum + a.moving_time, 0),
      totalElevation: Math.round(weekActivities.reduce((sum, a) => sum + a.total_elevation_gain, 0)),
      totalTSS: weekActivities.reduce((sum, a) => sum + calculateTSSWithThresholds(a, thresholds), 0),
      avgPower: Math.round(avgPower),
    })
  }

  return summaries.reverse()
}

// ==========================================
// Fat Burning & Heart Rate Zone Calculations
// ==========================================

export interface HRZone {
  name: string
  min: number
  max: number
  fatBurnRatio: number // Percentage of calories from fat at this zone
  color: string
}

// Calculate HR zones using Karvonen formula (Heart Rate Reserve method)
// More accurate than simple % of max HR
export function getHRZones(maxHR: number, restingHR: number): HRZone[] {
  const hrr = maxHR - restingHR // Heart Rate Reserve

  return [
    {
      name: 'Zone 1 (Recovery)',
      min: Math.round(restingHR + hrr * 0.5),
      max: Math.round(restingHR + hrr * 0.6),
      fatBurnRatio: 0.85, // 85% of calories from fat
      color: '#4a5568',
    },
    {
      name: 'Zone 2 (Fat Burn)',
      min: Math.round(restingHR + hrr * 0.6),
      max: Math.round(restingHR + hrr * 0.7),
      fatBurnRatio: 0.65, // 65% of calories from fat - optimal fat burning
      color: '#5a7a6b',
    },
    {
      name: 'Zone 3 (Aerobic)',
      min: Math.round(restingHR + hrr * 0.7),
      max: Math.round(restingHR + hrr * 0.8),
      fatBurnRatio: 0.45, // 45% from fat
      color: '#7a7a5a',
    },
    {
      name: 'Zone 4 (Threshold)',
      min: Math.round(restingHR + hrr * 0.8),
      max: Math.round(restingHR + hrr * 0.9),
      fatBurnRatio: 0.25, // 25% from fat
      color: '#8a6a5a',
    },
    {
      name: 'Zone 5 (Max)',
      min: Math.round(restingHR + hrr * 0.9),
      max: maxHR,
      fatBurnRatio: 0.1, // 10% from fat
      color: '#7a5a6a',
    },
  ]
}

// Get which HR zone a given heart rate falls into
export function getHRZoneForBPM(hr: number, maxHR: number, restingHR: number): HRZone | null {
  const zones = getHRZones(maxHR, restingHR)
  return zones.find((z) => hr >= z.min && hr < z.max) || null
}

// Estimate calories burned based on HR, duration, weight, and gender
// Using simplified Keytel formula
export function estimateCaloriesBurned(
  avgHR: number,
  durationSeconds: number,
  weight: number,
  age: number = 35,
  isMale: boolean = true
): number {
  const durationMinutes = durationSeconds / 60

  if (isMale) {
    // Male formula
    return Math.round(
      durationMinutes *
        (0.6309 * avgHR + 0.1988 * weight + 0.2017 * age - 55.0969) / 4.184
    )
  } else {
    // Female formula
    return Math.round(
      durationMinutes *
        (0.4472 * avgHR - 0.1263 * weight + 0.074 * age - 20.4022) / 4.184
    )
  }
}

// ==========================================
// Activity Scoring — Effort vs Terrain
// ==========================================

export interface ActivityScore {
  activityId: number
  name: string
  date: string
  dateKey: string
  rideScore: number
  difficultyScore: number
  effortScore: number
  distanceKm: number
  elevationGain: number
  avgGradient: number
  avgPower: number
  normalizedPower: number
  durationHours: number
  avgHR: number
}

// Terrain difficulty: "equivalent flat km" — each 100m climbing ≈ 8km extra flat effort
// This captures that a short steep ride is harder than a longer flat one
function calcDifficultyScore(distanceKm: number, elevationGain: number): number {
  return Math.round(distanceKm + (elevationGain / 100) * 8)
}

// Effort: power output sustained over time
// sqrt(hours) gives diminishing returns — 4h at 200W is harder than 1h but not 4×
function calcEffortScore(power: number, durationHours: number): number {
  if (!power || !durationHours) return 0
  return Math.round(power * Math.sqrt(durationHours) / 10)
}

// Ride Score is the same training load the plan and the fitness chart use —
// see calculateTSS in ./tss for the signal precedence. Keeping one source here
// is what stops a ride from reading 72 in the list and something else on /plan.
export function calculateActivityScores(
  activities: StravaActivity[],
  thresholds: TssThresholds,
): ActivityScore[] {
  const rides = activities.filter(
    (a) =>
      isRide(a) &&
      a.moving_time >= 600 &&
      (a.suffer_score || a.average_heartrate || a.average_watts)
  )

  return rides.map((ride) => {
    const np = ride.weighted_average_watts || ride.average_watts || 0
    const avgPower = ride.average_watts || 0
    const power = np || avgPower
    const distanceKm = ride.distance / 1000
    const durationHours = ride.moving_time / 3600
    const elevationGain = ride.total_elevation_gain || 0
    const avgGradient = distanceKm > 0 ? (elevationGain / (distanceKm * 1000)) * 100 : 0

    return {
      activityId: ride.id,
      name: ride.name,
      date: ride.start_date_local,
      dateKey: `${ride.start_date_local}_${ride.id}`,
      rideScore: calculateTSSWithThresholds(ride, thresholds),
      difficultyScore: calcDifficultyScore(distanceKm, elevationGain),
      effortScore: calcEffortScore(power, durationHours),
      distanceKm: Math.round(distanceKm * 10) / 10,
      elevationGain: Math.round(elevationGain),
      avgGradient: Math.round(avgGradient * 10) / 10,
      avgPower,
      normalizedPower: np,
      durationHours: Math.round(durationHours * 100) / 100,
      avgHR: ride.average_heartrate || 0,
    }
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

// ==========================================
// Running Performance Metrics
// ==========================================

export interface RunningMetrics {
  avgPace: number // seconds per km
  bestPace: number // seconds per km (from runs >= 5km)
  vo2max: number
  vo2maxCategory: string
  avgCadence: number // steps/min
  avgHR: number
  totalDistance: number // km
  totalRuns: number
}

// Format pace from seconds/km to "5:23" style string
export function formatPace(secsPerKm: number): string {
  if (!secsPerKm || !isFinite(secsPerKm)) return '--:--'
  const mins = Math.floor(secsPerKm / 60)
  const secs = Math.round(secsPerKm % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function calculateRunningMetrics(
  activities: StravaActivity[],
  age: number = 35,
  gender: 'male' | 'female' = 'male'
): RunningMetrics {
  const runs = activities.filter((a) => isRun(a))

  const empty: RunningMetrics = {
    avgPace: 0,
    bestPace: 0,
    vo2max: 0,
    vo2maxCategory: '',
    avgCadence: 0,
    avgHR: 0,
    totalDistance: 0,
    totalRuns: 0,
  }

  if (runs.length === 0) return empty

  // Avg pace across all runs (seconds per km)
  const paces = runs.map((r) => (r.distance > 0 ? r.moving_time / (r.distance / 1000) : 0)).filter((p) => p > 0)
  const avgPace = paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0

  // Best pace from runs >= 5km
  const longRuns = runs.filter((r) => r.distance >= 5000)
  const bestPace = longRuns.length > 0
    ? Math.min(...longRuns.map((r) => r.moving_time / (r.distance / 1000)))
    : 0

  // Estimate VO2max from best sustained pace using ACSM running equation
  // VO2 (ml/kg/min) = 0.2 × speed(m/min) + 0.9 × speed × grade + 3.5
  // For flat running (grade ≈ 0): VO2 ≈ 0.2 × speed(m/min) + 3.5
  // Best pace ≈ 93% VO2max effort, so VO2max ≈ VO2 / 0.93
  let vo2max = 0
  if (bestPace > 0) {
    const speedMPerMin = 1000 / (bestPace / 60) // convert s/km to m/min
    const vo2AtPace = 0.2 * speedMPerMin + 3.5
    vo2max = Math.round((vo2AtPace / 0.93) * 10) / 10
  }

  // Avg cadence (Strava reports half-cadence for running, so multiply by 2)
  const withCadence = runs.filter((r) => r.average_cadence && r.average_cadence > 0)
  const avgCadence = withCadence.length > 0
    ? Math.round(withCadence.reduce((s, r) => s + (r.average_cadence || 0), 0) / withCadence.length * 2)
    : 0

  // Avg HR from runs with HR data
  const withHR = runs.filter((r) => r.average_heartrate && r.average_heartrate > 0)
  const avgHR = withHR.length > 0
    ? Math.round(withHR.reduce((s, r) => s + (r.average_heartrate || 0), 0) / withHR.length)
    : 0

  const totalDistance = Math.round(runs.reduce((s, r) => s + r.distance, 0) / 1000 * 10) / 10

  return {
    avgPace,
    bestPace,
    vo2max,
    vo2maxCategory: vo2max > 0 ? getVO2maxCategory(vo2max, age, gender) : '',
    avgCadence,
    avgHR,
    totalDistance,
    totalRuns: runs.length,
  }
}
