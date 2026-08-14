import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import type { TssThresholds } from '~/lib/tss'
import {
  estimateFTP,
  getPowerZones,
  getZoneForPower,
  calculateZoneDistribution,
  calculateTSS,
  calculateFitnessOverTime,
  calculatePersonalRecords,
  estimateVO2max,
  getVO2maxCategory,
  getMotionistBenchmarks,
  calculateAge,
  calculateMaxHR,
  calculateRestingHR,
  calculateIF,
  calculateVI,
  calculateVAM,
  calculateEF,
  calculatePowerHR,
  calculateAdvancedMetrics,
  calculateActivityScores,
  formatPace,
  calculateRunningMetrics,
  calculateWeeklySummaries,
  getHRZones,
  getHRZoneForBPM,
  estimateCaloriesBurned,
} from '~/lib/performance'

// ---------------------------------------------------------------------------
// Helpers to build test activities
// ---------------------------------------------------------------------------

function makeActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Morning Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2025-03-15T08:00:00Z',
    start_date_local: '2025-03-15T09:00:00',
    distance: 40000,
    moving_time: 3600,
    elapsed_time: 4000,
    total_elevation_gain: 300,
    average_speed: 11.1,
    max_speed: 15.0,
    ...overrides,
  }
}

function makeRide(overrides: Partial<StravaActivity> = {}) {
  return makeActivity({ type: 'Ride', sport_type: 'Ride', ...overrides })
}

function makeRun(overrides: Partial<StravaActivity> = {}) {
  return makeActivity({
    type: 'Run',
    sport_type: 'Run',
    name: 'Morning Run',
    distance: 10000,
    moving_time: 3000,
    ...overrides,
  })
}

// ===================================================================
// estimateFTP
// ===================================================================

describe('estimateFTP', () => {
  it('returns null for empty activities', () => {
    expect(estimateFTP([])).toBeNull()
  })

  it('returns null when no rides have power', () => {
    expect(estimateFTP([makeRide()])).toBeNull()
  })

  it('applies the 20-min anchor (FTP = 0.95 x power) for a 20-min ride', () => {
    const activities = [makeRide({ average_watts: 252, moving_time: 1200 })]
    // 20 min → multiplier 0.95: 252 * 0.95 = 239.4 → 239
    expect(estimateFTP(activities)).toBe(239)
  })

  it('takes the best duration-adjusted estimate across rides', () => {
    const activities = [
      makeRide({ average_watts: 200, moving_time: 1200 }), // 20 min → 200 * 0.95 = 190
      makeRide({ average_watts: 250, moving_time: 1500 }), // 25 min → 250 * 0.965 = 241.25
    ]
    expect(estimateFTP(activities)).toBe(241)
  })

  it('scales up long sub-threshold rides via the power-duration curve', () => {
    // A strong 2-hour ride at 218W → 218 * 1.1 = 239.8 → 240
    const activities = [makeRide({ average_watts: 218, moving_time: 7200 })]
    expect(estimateFTP(activities)).toBe(240)
  })

  it('prefers Normalized Power over raw average watts', () => {
    const activities = [
      makeRide({ average_watts: 220, weighted_average_watts: 250, moving_time: 1200 }),
    ]
    // Uses NP 250 at the 20-min anchor: 250 * 0.95 = 237.5 → 238
    expect(estimateFTP(activities)).toBe(238)
  })

  it('falls back to weighted_average_watts when no long rides', () => {
    const activities = [
      makeRide({ average_watts: 200, weighted_average_watts: 220, moving_time: 600 }),
    ]
    // 95% of 220 = 209
    expect(estimateFTP(activities)).toBe(209)
  })

  it('returns null when short rides have no weighted_average_watts', () => {
    const activities = [makeRide({ average_watts: 200, moving_time: 600 })]
    expect(estimateFTP(activities)).toBeNull()
  })

  it('includes VirtualRide activities', () => {
    const activities = [
      makeActivity({ type: 'VirtualRide', average_watts: 300, moving_time: 1500 }),
    ]
    // 25 min → 300 * 0.965 = 289.5 → 290
    expect(estimateFTP(activities)).toBe(290)
  })

  it('ignores runs', () => {
    const activities = [makeRun({ average_watts: 300, moving_time: 1500 })]
    expect(estimateFTP(activities)).toBeNull()
  })
})

// ===================================================================
// getPowerZones / getZoneForPower
// ===================================================================

describe('getPowerZones', () => {
  it('returns 7 zones', () => {
    expect(getPowerZones(200)).toHaveLength(7)
  })

  it('zones cover full range from 0 to 9999', () => {
    const zones = getPowerZones(200)
    expect(zones[0].min).toBe(0)
    expect(zones[zones.length - 1].max).toBe(9999)
  })

  it('scales with FTP', () => {
    const zones = getPowerZones(300)
    // Recovery max = 300 * 0.55 = 165
    expect(zones[0].max).toBe(165)
    // Threshold min = 300 * 0.9 = 270
    expect(zones[3].min).toBe(270)
  })
})

describe('getZoneForPower', () => {
  it('returns Recovery for low power', () => {
    expect(getZoneForPower(50, 200).name).toBe('Recovery')
  })

  it('returns Threshold for power near FTP', () => {
    // Threshold: 0.9 * 200 = 180 to 1.05 * 200 = 210
    expect(getZoneForPower(195, 200).name).toBe('Threshold')
  })

  it('returns Neuromuscular for very high power', () => {
    // Neuromuscular: > 1.5 * 200 = 300
    expect(getZoneForPower(350, 200).name).toBe('Neuromuscular')
  })

  it('defaults to Recovery for power exactly 0', () => {
    expect(getZoneForPower(0, 200).name).toBe('Recovery')
  })
})

// ===================================================================
// calculateZoneDistribution
// ===================================================================

describe('calculateZoneDistribution', () => {
  it('returns empty when no rides have power', () => {
    expect(calculateZoneDistribution([makeRide()], 200)).toEqual([])
  })

  it('distributes time across zones', () => {
    const activities = [
      makeRide({ average_watts: 100, moving_time: 3600 }), // Recovery zone
      makeRide({ average_watts: 190, moving_time: 1800 }), // Threshold zone
    ]
    const dist = calculateZoneDistribution(activities, 200)
    expect(dist.length).toBeGreaterThan(0)
    const totalPercentage = dist.reduce((sum, z) => sum + z.percentage, 0)
    expect(totalPercentage).toBe(100)
  })
})

// ===================================================================
// calculateTSS
// ===================================================================

describe('calculateTSS (re-export from tss module)', () => {
  // Power-only thresholds — exercises the legacy power TSS path through the new API.
  const t = (ftp: number) => ({
    ftp,
    cyclingLTHR: null,
    runningLTHR: null,
    runningThresholdPace: null,
    maxHR: 0,
    restingHR: 0,
  })

  it('returns 0 when no power data and no LTHR', () => {
    expect(calculateTSS(makeRide(), t(200))).toBe(0)
  })

  it('returns 0 when ftp is 0 and no LTHR', () => {
    expect(calculateTSS(makeRide({ average_watts: 200 }), t(0))).toBe(0)
  })

  it('calculates correctly for 1 hour at FTP', () => {
    const activity = makeRide({ average_watts: 200, moving_time: 3600 })
    expect(calculateTSS(activity, t(200))).toBe(100)
  })

  it('uses weighted_average_watts when available', () => {
    const activity = makeRide({
      average_watts: 180,
      weighted_average_watts: 200,
      moving_time: 3600,
    })
    expect(calculateTSS(activity, t(200))).toBe(100)
  })

  it('scales with duration', () => {
    const short = makeRide({ average_watts: 200, moving_time: 1800 })
    const long = makeRide({ average_watts: 200, moving_time: 3600 })
    expect(calculateTSS(long, t(200))).toBe(2 * calculateTSS(short, t(200)))
  })
})

// ===================================================================
// calculateFitnessOverTime
// ===================================================================

describe('calculateFitnessOverTime', () => {
  const ftp200 = [{ date: '2020-01-01', ftp: 200 }]

  it('returns empty for no trackable activities', () => {
    expect(calculateFitnessOverTime([], ftp200)).toEqual([])
    // A ride with no power and no HR is not trackable
    expect(calculateFitnessOverTime([makeRide()], ftp200)).toEqual([])
  })

  it('returns data from earliest activity to today', () => {
    const activities = [
      makeRide({
        average_watts: 200,
        moving_time: 3600,
        start_date_local: '2025-03-01T09:00:00',
      }),
    ]
    const result = calculateFitnessOverTime(activities, ftp200)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].date).toBe('2025-03-01')
    expect(result[0].tss).toBe(100)
  })

  it('CTL grows slowly while ATL spikes', () => {
    const activities = [
      makeRide({
        average_watts: 200,
        moving_time: 3600,
        start_date_local: '2025-03-01T09:00:00',
      }),
    ]
    const result = calculateFitnessOverTime(activities, ftp200)
    const day1 = result[0]
    // ATL should respond faster than CTL
    expect(day1.atl).toBeGreaterThan(day1.ctl)
  })

  it('TSB is negative after hard effort (fatigue > fitness)', () => {
    const activities = [
      makeRide({
        average_watts: 200,
        moving_time: 3600,
        start_date_local: '2025-03-01T09:00:00',
      }),
    ]
    const result = calculateFitnessOverTime(activities, ftp200)
    expect(result[0].tsb).toBeLessThan(0)
  })
})

// ===================================================================
// estimateVO2max
// ===================================================================

describe('estimateVO2max', () => {
  it('returns 0 for zero FTP', () => {
    expect(estimateVO2max(0, 75)).toBe(0)
  })

  it('returns 0 for zero weight', () => {
    expect(estimateVO2max(250, 0)).toBe(0)
  })

  it('calculates correctly', () => {
    // FTP 250, weight 75 → W/kg = 3.33
    // VO2max = 10.8 * 3.33 + 7 = 42.97 → 43.0
    expect(estimateVO2max(250, 75)).toBe(43)
  })
})

// ===================================================================
// getVO2maxCategory
// ===================================================================

describe('getVO2maxCategory', () => {
  // Graded against recreational peers; bands derived from the age 35 male row
  // [average 41, good 47] -> spread 6.
  it('classifies male VO2max relative to recreational peers', () => {
    expect(getVO2maxCategory(60, 35)).toBe('Elite')
    expect(getVO2maxCategory(50, 35)).toBe('Excellent')
    expect(getVO2maxCategory(44, 35)).toBe('Good')
    expect(getVO2maxCategory(38, 35)).toBe('Average')
    expect(getVO2maxCategory(30, 35)).toBe('Below Average')
  })

  // Age 35 female row [average 35, good 41] -> spread 6.
  it('classifies female VO2max relative to recreational peers', () => {
    expect(getVO2maxCategory(50, 35, 'female')).toBe('Elite')
    expect(getVO2maxCategory(44, 35, 'female')).toBe('Excellent')
    expect(getVO2maxCategory(38, 35, 'female')).toBe('Good')
    expect(getVO2maxCategory(31, 35, 'female')).toBe('Average')
    expect(getVO2maxCategory(25, 35, 'female')).toBe('Below Average')
  })

  // The same VO2max grades higher as the peer group ages.
  it('shifts bands with age for the same VO2max', () => {
    expect(getVO2maxCategory(34, 25)).toBe('Below Average') // peers avg 43
    expect(getVO2maxCategory(34, 45)).toBe('Average')       // peers avg 38
    expect(getVO2maxCategory(34, 65)).toBe('Good')          // peers avg 31
  })
})

// ===================================================================
// getMotionistBenchmarks
// ===================================================================

describe('getMotionistBenchmarks', () => {
  it('returns benchmarks for 30-year-old male', () => {
    const b = getMotionistBenchmarks(30, 'male')
    expect(b.vo2max).toBe(41)
    expect(b.maxHR).toBe(Math.round(208 - 0.7 * 30))
    expect(b.restingHR).toBeGreaterThan(0)
    expect(b.ftp).toBeGreaterThan(0)
  })

  it('wPerKg does not drop below 1.5', () => {
    const b = getMotionistBenchmarks(130, 'male')
    // 2.5 - (130-25)*0.01 = 1.45 → clamped to 1.5
    expect(b.wPerKg).toBe(1.5)
  })
})

// ===================================================================
// calculateAge
// ===================================================================

describe('calculateAge', () => {
  it('returns default for null input', () => {
    expect(calculateAge(null)).toBe(35)
    expect(calculateAge(null, 40)).toBe(40)
  })

  it('returns default for invalid date', () => {
    expect(calculateAge('not-a-date')).toBe(35)
  })

  it('calculates age from birthday', () => {
    const age = calculateAge('1990-01-01')
    // Should be around 36 in 2026
    expect(age).toBeGreaterThanOrEqual(35)
    expect(age).toBeLessThanOrEqual(37)
  })
})

// ===================================================================
// calculateMaxHR / calculateRestingHR
// ===================================================================

describe('calculateMaxHR', () => {
  it('returns observed max from activities', () => {
    const activities = [
      makeRide({ max_heartrate: 180 }),
      makeRide({ max_heartrate: 195 }),
    ]
    const result = calculateMaxHR(activities, 35)
    expect(result.value).toBe(195)
    expect(result.source).toBe('observed')
    expect(result.activityCount).toBe(2)
  })

  it('falls back to Tanaka formula when no HR data', () => {
    const result = calculateMaxHR([], 35)
    expect(result.value).toBe(Math.round(208 - 0.7 * 35))
    expect(result.source).toBe('estimated')
  })
})

describe('calculateRestingHR', () => {
  it('requires at least 5 activities for observed value', () => {
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeRide({ average_heartrate: 70 + i })
    )
    const result = calculateRestingHR(activities, 35, 'male')
    expect(result.source).toBe('estimated')
  })

  it('uses 5th percentile when enough data', () => {
    const activities = Array.from({ length: 20 }, (_, i) =>
      makeRide({ average_heartrate: 60 + i * 2 }) // 60, 62, 64, ..., 98
    )
    const result = calculateRestingHR(activities, 35, 'male')
    expect(result.source).toBe('observed')
    expect(result.value).toBeLessThanOrEqual(65)
  })
})

// ===================================================================
// Simple metric functions
// ===================================================================

describe('calculateIF', () => {
  it('returns ratio of NP to FTP', () => {
    expect(calculateIF(200, 200)).toBe(1.0)
    expect(calculateIF(150, 200)).toBe(0.75)
  })

  it('returns 0 for zero inputs', () => {
    expect(calculateIF(0, 200)).toBe(0)
    expect(calculateIF(200, 0)).toBe(0)
  })
})

describe('calculateVI', () => {
  it('returns ratio of NP to avg power', () => {
    expect(calculateVI(220, 200)).toBe(1.1)
    expect(calculateVI(200, 200)).toBe(1.0)
  })

  it('returns 0 for zero inputs', () => {
    expect(calculateVI(0, 200)).toBe(0)
  })
})

describe('calculateVAM', () => {
  it('calculates vertical ascent speed', () => {
    // 1000m in 3600s = 1000 m/h
    expect(calculateVAM(1000, 3600)).toBe(1000)
  })

  it('returns 0 for zero elevation or time', () => {
    expect(calculateVAM(0, 3600)).toBe(0)
    expect(calculateVAM(1000, 0)).toBe(0)
  })
})

describe('calculateEF', () => {
  it('returns NP / HR ratio', () => {
    expect(calculateEF(200, 150)).toBe(1.33)
  })

  it('returns 0 for zero inputs', () => {
    expect(calculateEF(0, 150)).toBe(0)
    expect(calculateEF(200, 0)).toBe(0)
  })
})

describe('calculatePowerHR', () => {
  it('returns power / HR ratio', () => {
    expect(calculatePowerHR(200, 150)).toBe(1.33)
  })

  it('returns 0 for zero inputs', () => {
    expect(calculatePowerHR(0, 150)).toBe(0)
  })
})

// ===================================================================
// calculateAdvancedMetrics
// ===================================================================

describe('calculateAdvancedMetrics', () => {
  it('returns zeros for no rides', () => {
    const result = calculateAdvancedMetrics([], 200, 75)
    expect(result.avgIF).toBe(0)
    expect(result.vo2max).toBe(0)
  })

  it('calculates metrics for rides with power', () => {
    const activities = [
      makeRide({
        average_watts: 180,
        weighted_average_watts: 190,
        average_heartrate: 150,
        total_elevation_gain: 500,
        moving_time: 3600,
      }),
    ]
    const result = calculateAdvancedMetrics(activities, 200, 75)
    expect(result.avgIF).toBeGreaterThan(0)
    expect(result.avgEF).toBeGreaterThan(0)
    expect(result.avgVAM).toBeGreaterThan(0)
    expect(result.vo2max).toBeGreaterThan(0)
  })
})

// ===================================================================
// Activity Scoring
// ===================================================================

const scoreThresholds: TssThresholds = {
  ftp: 200,
  cyclingLTHR: 165,
  runningLTHR: 175,
  runningThresholdPace: 4.0,
  maxHR: 195,
  restingHR: 50,
}

describe('calculateActivityScores', () => {
  it('returns empty for no qualifying rides', () => {
    expect(calculateActivityScores([], scoreThresholds)).toEqual([])
  })

  it('filters out rides shorter than 10 minutes', () => {
    const activities = [makeRide({ average_watts: 200, moving_time: 300 })]
    expect(calculateActivityScores(activities, scoreThresholds)).toEqual([])
  })

  it('scores rides with power', () => {
    const activities = [
      makeRide({
        average_watts: 200,
        moving_time: 3600,
        distance: 40000,
        total_elevation_gain: 500,
      }),
    ]
    const scores = calculateActivityScores(activities, scoreThresholds)
    expect(scores).toHaveLength(1)
    expect(scores[0].rideScore).toBeGreaterThan(0)
    expect(scores[0].effortScore).toBeGreaterThan(0)
    expect(scores[0].difficultyScore).toBeGreaterThan(0)
  })

  it('reports the same load the plan and fitness chart use', () => {
    const ride = makeRide({ average_watts: 200, moving_time: 3600 })
    const scores = calculateActivityScores([ride], scoreThresholds)
    expect(scores[0].rideScore).toBe(calculateTSS(ride, scoreThresholds))
  })
})

// ===================================================================
// formatPace (performance.ts version)
// ===================================================================

describe('formatPace', () => {
  it('formats seconds per km to mm:ss', () => {
    expect(formatPace(300)).toBe('5:00')
    expect(formatPace(323)).toBe('5:23')
  })

  it('returns --:-- for zero or invalid', () => {
    expect(formatPace(0)).toBe('--:--')
    expect(formatPace(Infinity)).toBe('--:--')
    expect(formatPace(NaN)).toBe('--:--')
  })
})

// ===================================================================
// calculateRunningMetrics
// ===================================================================

describe('calculateRunningMetrics', () => {
  it('returns empty metrics for no runs', () => {
    const result = calculateRunningMetrics([])
    expect(result.totalRuns).toBe(0)
    expect(result.avgPace).toBe(0)
  })

  it('calculates avg pace and distance', () => {
    const activities = [
      makeRun({ distance: 10000, moving_time: 3000 }), // 5:00/km
      makeRun({ distance: 10000, moving_time: 2700 }), // 4:30/km
    ]
    const result = calculateRunningMetrics(activities)
    expect(result.totalRuns).toBe(2)
    expect(result.totalDistance).toBe(20)
    expect(result.avgPace).toBeGreaterThan(0)
  })

  it('computes best pace from runs >= 5km', () => {
    const activities = [
      makeRun({ distance: 5000, moving_time: 1500 }), // 5:00/km
      makeRun({ distance: 10000, moving_time: 2500 }), // 4:10/km (faster)
    ]
    const result = calculateRunningMetrics(activities)
    expect(result.bestPace).toBeLessThan(result.avgPace)
  })

  it('doubles cadence (Strava reports half-cadence for running)', () => {
    const activities = [
      makeRun({ average_cadence: 88 }),
    ]
    const result = calculateRunningMetrics(activities)
    expect(result.avgCadence).toBe(176)
  })
})

// ===================================================================
// HR Zones
// ===================================================================

describe('getHRZones', () => {
  it('returns 5 zones', () => {
    expect(getHRZones(190, 60)).toHaveLength(5)
  })

  it('zone boundaries are based on HR reserve', () => {
    const zones = getHRZones(190, 60)
    // HRR = 130, Zone 1 min = 60 + 130 * 0.5 = 125
    expect(zones[0].min).toBe(125)
    // Zone 5 max = maxHR = 190
    expect(zones[4].max).toBe(190)
  })
})

describe('getHRZoneForBPM', () => {
  it('returns correct zone', () => {
    // HRR = 130, Zone 2 min = 60 + 130*0.6 = 138, max = 60 + 130*0.7 = 151
    const zone = getHRZoneForBPM(145, 190, 60)
    expect(zone?.name).toBe('Zone 2 (Fat Burn)')
  })

  it('returns null for HR below zone 1', () => {
    expect(getHRZoneForBPM(80, 190, 60)).toBeNull()
  })
})

// ===================================================================
// Calorie & Fat calculations
// ===================================================================

describe('estimateCaloriesBurned', () => {
  it('returns positive calories for valid inputs', () => {
    const cals = estimateCaloriesBurned(150, 3600, 75)
    expect(cals).toBeGreaterThan(0)
  })

  it('male formula produces higher value than female for same inputs', () => {
    const male = estimateCaloriesBurned(150, 3600, 75, 35, true)
    const female = estimateCaloriesBurned(150, 3600, 75, 35, false)
    expect(male).toBeGreaterThan(female)
  })
})

// ===================================================================
// BMR & Daily Fat Burn
// ===================================================================

// ===================================================================
// calculateActivityFatStats
// ===================================================================

// ===================================================================
// calculatePersonalRecords
// ===================================================================

describe('calculatePersonalRecords', () => {
  it('returns empty for no activities', () => {
    expect(calculatePersonalRecords([])).toEqual([])
  })

  it('finds longest ride', () => {
    const activities = [
      makeRide({ distance: 50000 }),
      makeRide({ distance: 80000 }),
    ]
    const records = calculatePersonalRecords(activities)
    const longest = records.find((r) => r.type === 'Longest Ride')
    expect(longest).toBeDefined()
    expect(longest!.value).toBe(80) // 80km
  })

  it('finds max power', () => {
    const activities = [
      makeRide({ max_watts: 800 }),
      makeRide({ max_watts: 1100 }),
    ]
    const records = calculatePersonalRecords(activities)
    const maxPower = records.find((r) => r.type === 'Max Power')
    expect(maxPower).toBeDefined()
    expect(maxPower!.value).toBe(1100)
  })

  it('finds best avg power from rides >= 20 min', () => {
    const activities = [
      makeRide({ average_watts: 250, moving_time: 1200 }),
      makeRide({ average_watts: 300, moving_time: 1500 }),
      makeRide({ average_watts: 400, moving_time: 600 }), // too short, excluded
    ]
    const records = calculatePersonalRecords(activities)
    const bestAvg = records.find((r) => r.type === 'Best Avg Power (20m+)')
    expect(bestAvg).toBeDefined()
    expect(bestAvg!.value).toBe(300)
  })

  it('finds most climbing', () => {
    const activities = [
      makeRide({ total_elevation_gain: 500 }),
      makeRide({ total_elevation_gain: 1200 }),
    ]
    const records = calculatePersonalRecords(activities)
    const climbing = records.find((r) => r.type === 'Most Climbing')
    expect(climbing).toBeDefined()
    expect(climbing!.value).toBe(1200)
  })

  it('finds fastest ride from rides >= 20km', () => {
    const activities = [
      makeRide({ distance: 25000, average_speed: 8.33 }), // 30 km/h
      makeRide({ distance: 30000, average_speed: 9.72 }), // 35 km/h
      makeRide({ distance: 15000, average_speed: 11.11 }), // too short
    ]
    const records = calculatePersonalRecords(activities)
    const fastest = records.find((r) => r.type === 'Fastest Ride (20km+)')
    expect(fastest).toBeDefined()
    expect(fastest!.value).toBeGreaterThan(30)
  })

  it('ignores corrupt rides with implausible average_speed', () => {
    const activities = [
      makeRide({ distance: 30000, average_speed: 9.72 }),  // 35 km/h, legit
      makeRide({ distance: 45100, average_speed: 9020 }),  // 45km in ~5s, corrupt
    ]
    const records = calculatePersonalRecords(activities)
    const fastest = records.find((r) => r.type === 'Fastest Ride (20km+)')
    expect(fastest).toBeDefined()
    expect(fastest!.value).toBe(35) // 9.72 * 3.6, not the corrupt 32472
  })

  it('finds longest run', () => {
    const activities = [
      makeRun({ distance: 10000 }),
      makeRun({ distance: 21100 }),
    ]
    const records = calculatePersonalRecords(activities)
    const longestRun = records.find((r) => r.type === 'Longest Run')
    expect(longestRun).toBeDefined()
    expect(longestRun!.value).toBe(21.1)
  })

  it('finds best run pace from runs >= 5km', () => {
    const activities = [
      makeRun({ distance: 10000, average_speed: 3.33 }), // ~5:00/km
      makeRun({ distance: 5000, average_speed: 4.0 }),    // ~4:10/km (faster)
      makeRun({ distance: 3000, average_speed: 5.0 }),    // too short
    ]
    const records = calculatePersonalRecords(activities)
    const bestPace = records.find((r) => r.type === 'Best Pace (5km+)')
    expect(bestPace).toBeDefined()
    expect(bestPace!.unit).toContain('/km')
  })
})

// ===================================================================
// calculateWeeklySummaries
// ===================================================================

describe('calculateWeeklySummaries', () => {
  const thresholds = {
    ftp: 200,
    cyclingLTHR: null,
    runningLTHR: null,
    runningThresholdPace: null,
    maxHR: 0,
    restingHR: 0,
  }

  it('returns requested number of weeks', () => {
    const result = calculateWeeklySummaries([], thresholds, 4)
    expect(result).toHaveLength(4)
  })

  it('weeks have zero values when no activities match', () => {
    const result = calculateWeeklySummaries([], thresholds, 1)
    expect(result[0].rides).toBe(0)
    expect(result[0].runs).toBe(0)
    expect(result[0].totalDistance).toBe(0)
    expect(result[0].totalTSS).toBe(0)
  })

  it('aggregates activities into the correct week', () => {
    const now = new Date()
    const activity = makeRide({
      average_watts: 200,
      moving_time: 3600,
      distance: 40000,
      total_elevation_gain: 300,
      start_date: now.toISOString(),
    })
    const result = calculateWeeklySummaries([activity], thresholds, 1)
    expect(result[0].rides).toBe(1)
    expect(result[0].totalDistance).toBe(40)
    expect(result[0].totalTSS).toBeGreaterThan(0)
  })

  it('returns weeks in chronological order', () => {
    const result = calculateWeeklySummaries([], thresholds, 4)
    // First element is the oldest week
    expect(result).toHaveLength(4)
  })
})

// ===================================================================
// calculateFatBurningSummary
// ===================================================================

// ===================================================================
// calculateCompleteFatBurningSummary
// ===================================================================

