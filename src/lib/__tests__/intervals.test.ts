import { describe, it, expect } from 'vitest'
import {
  INTERVALS_ID_OFFSET,
  isIntervalsActivityId,
  toIntervalsApiId,
  fromIntervalsApiId,
  mapIntervalsActivity,
  activityTypeFamily,
  encodePolyline,
  computeSplitsFromStreams,
  estimatePowerStream,
  averageMovingPower,
  type IntervalsActivity,
} from '~/lib/intervals'

function makeIntervalsActivity(overrides: Partial<IntervalsActivity> = {}): IntervalsActivity {
  return {
    id: 'i164403937',
    name: 'Morning Ride',
    type: 'Ride',
    sub_type: null,
    start_date: '2026-07-09T09:15:02Z',
    start_date_local: '2026-07-09T11:15:02',
    distance: 44380.99,
    moving_time: 5771,
    elapsed_time: 5952,
    total_elevation_gain: 280,
    average_speed: 7.678,
    max_speed: 15.34,
    icu_average_watts: null,
    icu_weighted_avg_watts: null,
    icu_joules: null,
    device_watts: null,
    average_heartrate: 145,
    max_heartrate: 169,
    average_cadence: 79.77,
    icu_training_load: 102,
    icu_weight: null,
    calories: 1127,
    device_name: 'Garmin Edge 830',
    description: null,
    average_temp: null,
    perceived_exertion: null,
    icu_rpe: null,
    trainer: null,
    strava_id: null,
    stream_types: ['time', 'heartrate', 'distance'],
    ...overrides,
  }
}

describe('intervals id mapping', () => {
  it('round-trips an intervals api id', () => {
    const id = fromIntervalsApiId('i164403937')
    expect(id).toBe(INTERVALS_ID_OFFSET + 164403937)
    expect(toIntervalsApiId(id)).toBe('i164403937')
  })

  it('classifies ids by source', () => {
    expect(isIntervalsActivityId(fromIntervalsApiId('i164403937'))).toBe(true)
    expect(isIntervalsActivityId(19113368753)).toBe(false) // recent Strava id
    expect(isIntervalsActivityId(563166268)).toBe(false) // 2014-era Strava id
  })
})

describe('mapIntervalsActivity', () => {
  it('maps core fields onto the StravaActivity shape', () => {
    const mapped = mapIntervalsActivity(makeIntervalsActivity())
    expect(mapped.id).toBe(INTERVALS_ID_OFFSET + 164403937)
    expect(mapped.type).toBe('Ride')
    expect(mapped.start_date).toBe('2026-07-09T09:15:02Z')
    expect(mapped.distance).toBeCloseTo(44380.99)
    expect(mapped.average_heartrate).toBe(145)
    expect(mapped.suffer_score).toBe(102)
    expect(mapped.average_watts).toBeUndefined()
  })

  it('prefers the strava id when intervals knows it', () => {
    const mapped = mapIntervalsActivity(makeIntervalsActivity({ strava_id: '19113368753' }))
    expect(mapped.id).toBe(19113368753)
  })

  it('converts joules to kilojoules', () => {
    const mapped = mapIntervalsActivity(makeIntervalsActivity({ icu_joules: 479146 }))
    expect(mapped.kilojoules).toBeCloseTo(479.146)
  })
})

describe('activityTypeFamily', () => {
  it('groups the variants the two sources use interchangeably', () => {
    expect(activityTypeFamily('VirtualRide')).toBe(activityTypeFamily('Ride'))
    expect(activityTypeFamily('TrailRun')).toBe(activityTypeFamily('Run'))
    expect(activityTypeFamily('Hike')).toBe(activityTypeFamily('Walk'))
  })

  it('keeps unrelated types apart and passes unknown ones through', () => {
    expect(activityTypeFamily('Ride')).not.toBe(activityTypeFamily('Run'))
    expect(activityTypeFamily('WeightTraining')).toBe('WeightTraining')
  })
})

describe('encodePolyline', () => {
  it('encodes the canonical Google example', () => {
    const points: Array<[number, number]> = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  it('returns an empty string for no points', () => {
    expect(encodePolyline([])).toBe('')
  })
})

describe('estimatePowerStream', () => {
  // Constant 30 km/h (8.33 m/s) on a dead-flat road, 75 kg rider.
  // Physics says roughly 150 W (aero-dominated) — sanity-check the model.
  function flatRide(n: number, speedMs: number) {
    const time = Array.from({ length: n }, (_, i) => i)
    const velocity = Array.from({ length: n }, () => speedMs)
    const distance = Array.from({ length: n }, (_, i) => i * speedMs)
    const altitude = Array.from({ length: n }, () => 10)
    return { time, velocity, distance, altitude }
  }

  it('estimates ~150W for 30 km/h on the flat at 75 kg', () => {
    const { time, velocity, distance, altitude } = flatRide(600, 8.33)
    const watts = estimatePowerStream(time, velocity, distance, altitude, 75)
    const avg = averageMovingPower(watts, velocity)
    expect(avg).toBeGreaterThan(120)
    expect(avg).toBeLessThan(180)
  })

  it('estimates more power uphill than on the flat at the same speed', () => {
    const { time, velocity, distance } = flatRide(600, 5)
    const flat = Array.from({ length: 600 }, () => 10)
    const climb = Array.from({ length: 600 }, (_, i) => 10 + i * 5 * 0.05) // 5% grade
    const flatAvg = averageMovingPower(
      estimatePowerStream(time, velocity, distance, flat, 75),
      velocity
    )
    const climbAvg = averageMovingPower(
      estimatePowerStream(time, velocity, distance, climb, 75),
      velocity
    )
    expect(climbAvg).toBeGreaterThan(flatAvg * 2)
  })

  it('estimates zero power when stationary', () => {
    const n = 60
    const time = Array.from({ length: n }, (_, i) => i)
    const velocity = Array.from({ length: n }, () => 0)
    const distance = Array.from({ length: n }, () => 0)
    const altitude = Array.from({ length: n }, () => 10)
    const watts = estimatePowerStream(time, velocity, distance, altitude, 75)
    expect(Math.max(...watts)).toBe(0)
  })

  it('a heavier rider needs more power on a climb', () => {
    const { time, velocity, distance } = flatRide(600, 5)
    const climb = Array.from({ length: 600 }, (_, i) => 10 + i * 5 * 0.05)
    const light = averageMovingPower(
      estimatePowerStream(time, velocity, distance, climb, 60),
      velocity
    )
    const heavy = averageMovingPower(
      estimatePowerStream(time, velocity, distance, climb, 95),
      velocity
    )
    expect(heavy).toBeGreaterThan(light)
  })
})

describe('computeSplitsFromStreams', () => {
  it('produces one split per km plus the final partial', () => {
    // 2.5 km at exactly 5 m/s (200s per km)
    const n = 501
    const time = Array.from({ length: n }, (_, i) => i)
    const distance = Array.from({ length: n }, (_, i) => i * 5)

    const splits = computeSplitsFromStreams(time, distance)
    expect(splits).toHaveLength(3)
    expect(splits[0].split).toBe(1)
    expect(splits[0].distance).toBeGreaterThanOrEqual(1000)
    expect(splits[0].average_speed).toBeCloseTo(5, 0)
    expect(splits[2].distance).toBeLessThan(1000) // partial
  })

  it('averages heart rate per split when provided', () => {
    const n = 201
    const time = Array.from({ length: n }, (_, i) => i)
    const distance = Array.from({ length: n }, (_, i) => i * 5)
    const hr = Array.from({ length: n }, () => 150)

    const splits = computeSplitsFromStreams(time, distance, hr)
    expect(splits[0].average_heartrate).toBeCloseTo(150)
  })

  it('returns empty for missing streams', () => {
    expect(computeSplitsFromStreams([], [])).toEqual([])
  })
})
