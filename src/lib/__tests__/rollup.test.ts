import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import { rollup, toSyntheticActivity } from '~/lib/rollup'

function makeActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2026-08-01T08:00:00Z',
    start_date_local: '2026-08-01T10:00:00',
    distance: 30000,
    moving_time: 3600,
    elapsed_time: 3700,
    total_elevation_gain: 100,
    average_speed: 8.33,
    max_speed: 12,
    ...overrides,
  }
}

describe('rollup — intensity averages are duration-weighted', () => {
  // The case the three old implementations disagreed on: a short hard opener
  // and a long steady ride. An unweighted mean says 250 W; the time-weighted
  // answer is far closer to the endurance ride that accumulated the load.
  const opener = makeActivity({ id: 1, moving_time: 1200, average_watts: 300, average_heartrate: 170 })
  const endurance = makeActivity({ id: 2, moving_time: 10800, average_watts: 200, average_heartrate: 130 })

  it('weights average power by duration, not by activity count', () => {
    const r = rollup([opener, endurance])!
    const unweightedMean = (300 + 200) / 2
    const expected = (300 * 1200 + 200 * 10800) / (1200 + 10800)

    expect(r.avgWatts).toBeCloseTo(expected, 6)
    expect(r.avgWatts).toBeLessThan(unweightedMean)
    expect(r.avgWatts).toBeCloseTo(210, 0)
  })

  it('weights average heart rate the same way', () => {
    const r = rollup([opener, endurance])!
    expect(r.avgHeartrate).toBeCloseTo((170 * 1200 + 130 * 10800) / 12000, 6)
  })

  it('is order-independent', () => {
    expect(rollup([opener, endurance])!.avgWatts).toBeCloseTo(
      rollup([endurance, opener])!.avgWatts!,
      9
    )
  })

  it('ignores members missing the value rather than treating them as zero', () => {
    const noPower = makeActivity({ id: 3, moving_time: 3600, average_watts: undefined })
    const withPower = makeActivity({ id: 4, moving_time: 3600, average_watts: 200 })
    expect(rollup([noPower, withPower])!.avgWatts).toBe(200)
  })

  it('leaves the average undefined when no member has the value', () => {
    const r = rollup([makeActivity({ average_watts: undefined })])!
    expect(r.avgWatts).toBeUndefined()
    expect(r.normalizedWatts).toBeUndefined()
    expect(r.avgHeartrate).toBeUndefined()
  })
})

describe('rollup — totals and extremes', () => {
  const a = makeActivity({ id: 1, distance: 20000, moving_time: 3600, total_elevation_gain: 300, max_speed: 14, suffer_score: 60, kilojoules: 700 })
  const b = makeActivity({ id: 2, distance: 30000, moving_time: 5400, total_elevation_gain: 500, max_speed: 18, suffer_score: 90, kilojoules: 1100 })

  it('sums distance, time and elevation', () => {
    const r = rollup([a, b])!
    expect(r.distance).toBe(50000)
    expect(r.movingTime).toBe(9000)
    expect(r.elevation).toBe(800)
  })

  it('sums training load — load is additive, unlike intensity', () => {
    expect(rollup([a, b])!.trainingLoad).toBe(150)
    expect(rollup([a, b])!.kilojoules).toBe(1800)
  })

  it('takes the max of maxima', () => {
    expect(rollup([a, b])!.maxSpeed).toBe(18)
  })

  it('returns null for no activities', () => {
    expect(rollup([])).toBeNull()
  })
})

describe('rollup — identity', () => {
  it('picks the earliest and latest by start date regardless of input order', () => {
    const early = makeActivity({ id: 1, start_date: '2026-08-01T08:00:00Z' })
    const late = makeActivity({ id: 2, start_date: '2026-08-03T08:00:00Z' })
    const r = rollup([late, early])!
    expect(r.earliest.id).toBe(1)
    expect(r.latest.id).toBe(2)
  })

  it('picks the most common type', () => {
    const r = rollup([
      makeActivity({ id: 1, type: 'VirtualRide' }),
      makeActivity({ id: 2, type: 'VirtualRide' }),
      makeActivity({ id: 3, type: 'Ride' }),
    ])!
    expect(r.predominantType).toBe('VirtualRide')
  })

  it('rolling up one activity reproduces its own values', () => {
    const one = makeActivity({ average_watts: 220, average_heartrate: 145, suffer_score: 75 })
    const r = rollup([one])!
    expect(r.avgWatts).toBe(220)
    expect(r.avgHeartrate).toBe(145)
    expect(r.trainingLoad).toBe(75)
    expect(r.distance).toBe(one.distance)
  })
})

describe('toSyntheticActivity', () => {
  const members = [
    makeActivity({ id: 1, moving_time: 1200, distance: 10000, average_watts: 300, suffer_score: 30 }),
    makeActivity({ id: 2, moving_time: 3600, distance: 30000, average_watts: 200, suffer_score: 70 }),
  ]

  it('carries the rolled-up values onto one activity', () => {
    const synthetic = toSyntheticActivity(rollup(members)!, -1, 'Double day')
    expect(synthetic.id).toBe(-1)
    expect(synthetic.name).toBe('Double day')
    expect(synthetic.distance).toBe(40000)
    expect(synthetic.moving_time).toBe(4800)
    expect(synthetic.suffer_score).toBe(100)
  })

  it('derives average speed from the summed distance and time', () => {
    const synthetic = toSyntheticActivity(rollup(members)!, -1, 'Double day')
    expect(synthetic.average_speed).toBeCloseTo(40000 / 4800, 6)
  })

  it('starts at the earliest member', () => {
    const synthetic = toSyntheticActivity(rollup(members)!, -1, 'Double day')
    expect(synthetic.start_date).toBe(members[0].start_date)
  })
})
