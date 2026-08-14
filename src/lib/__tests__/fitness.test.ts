import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import type { TssThresholds } from '~/lib/tss'
import { fitnessSeries, loadBetween } from '~/lib/fitness'

function makeRide(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Morning Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2025-03-01T08:00:00Z',
    start_date_local: '2025-03-01T09:00:00',
    distance: 40000,
    moving_time: 3600,
    elapsed_time: 4000,
    total_elevation_gain: 300,
    average_speed: 11.1,
    max_speed: 15.0,
    ...overrides,
  }
}

function makeRun(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return makeRide({
    type: 'Run',
    sport_type: 'Run',
    name: 'Morning Run',
    distance: 12000,
    moving_time: 3000,
    average_speed: 4.0,
    ...overrides,
  })
}

const ftp200 = [{ date: '2020-01-01', ftp: 200 }]

const powerOnly: TssThresholds = {
  ftp: 200,
  cyclingLTHR: null,
  runningLTHR: null,
  runningThresholdPace: null,
  maxHR: 0,
  restingHR: 0,
}

const withHR: TssThresholds = { ...powerOnly, cyclingLTHR: 165, runningLTHR: 175, runningThresholdPace: 4.0 }

// A fixed "today" keeps the series length deterministic.
const TODAY = new Date('2025-03-10T12:00:00')

describe('fitnessSeries', () => {
  it('returns an empty series when nothing carries load', () => {
    expect(fitnessSeries([], { ftpHistory: ftp200, thresholds: powerOnly }, TODAY).days).toEqual([])
    // A ride with no power, no HR and no reported load is not trackable
    const series = fitnessSeries([makeRide()], { ftpHistory: ftp200, thresholds: powerOnly }, TODAY)
    expect(series.days).toEqual([])
    expect(series.latest).toBeNull()
  })

  it('runs from the earliest activity to today', () => {
    const series = fitnessSeries(
      [makeRide({ average_watts: 200, moving_time: 3600 })],
      { ftpHistory: ftp200, thresholds: powerOnly },
      TODAY
    )
    expect(series.days[0].date).toBe('2025-03-01')
    expect(series.days[0].tss).toBe(100)
    expect(series.days[series.days.length - 1].date).toBe('2025-03-10')
  })

  it('ATL responds faster than CTL, and form goes negative after a hard day', () => {
    const series = fitnessSeries(
      [makeRide({ average_watts: 200, moving_time: 3600 })],
      { ftpHistory: ftp200, thresholds: powerOnly },
      TODAY
    )
    const day1 = series.days[0]
    expect(day1.atl).toBeGreaterThan(day1.ctl)
    expect(day1.tsb).toBeLessThan(0)
  })

  it('exposes latest as the final day', () => {
    const series = fitnessSeries(
      [makeRide({ average_watts: 200 })],
      { ftpHistory: ftp200, thresholds: powerOnly },
      TODAY
    )
    expect(series.latest).toEqual(series.days[series.days.length - 1])
  })
})

describe('fitnessSeries — no longer gated on a power-derived FTP history', () => {
  // This is the fix: the curve used to bail out entirely when FTP history was
  // empty, so an HR-only cyclist or a runner saw "need more rides with power".
  it('builds a curve for an HR-only cyclist with no FTP history at all', () => {
    const series = fitnessSeries(
      [makeRide({ average_heartrate: 165, moving_time: 3600 })],
      { ftpHistory: [], thresholds: withHR },
      TODAY
    )
    expect(series.days.length).toBeGreaterThan(0)
    expect(series.days[0].tss).toBeGreaterThan(0)
    expect(series.latest!.ctl).toBeGreaterThan(0)
  })

  it('builds a curve for a runner with no FTP history at all', () => {
    const series = fitnessSeries(
      [makeRun({ average_speed: 4.0, moving_time: 3600 })],
      { ftpHistory: [], thresholds: withHR },
      TODAY
    )
    expect(series.days[0].tss).toBeGreaterThan(0)
  })
})

describe('fitnessSeries — dailyTss agrees with the curve', () => {
  const rides = [
    makeRide({ id: 1, average_watts: 200, moving_time: 3600, start_date_local: '2025-03-01T09:00:00' }),
    makeRide({ id: 2, average_watts: 200, moving_time: 1800, start_date_local: '2025-03-03T09:00:00' }),
  ]
  const series = fitnessSeries(rides, { ftpHistory: ftp200, thresholds: powerOnly }, TODAY)

  it('records the same load per day that the curve consumed', () => {
    for (const day of series.days) {
      expect(series.dailyTss.get(day.date)).toBe(day.tss)
    }
  })

  it('sums two rides landing on the same day', () => {
    const sameDay = fitnessSeries(
      [
        makeRide({ id: 1, average_watts: 200, moving_time: 3600, start_date_local: '2025-03-01T09:00:00' }),
        makeRide({ id: 2, average_watts: 200, moving_time: 3600, start_date_local: '2025-03-01T17:00:00' }),
      ],
      { ftpHistory: ftp200, thresholds: powerOnly },
      TODAY
    )
    expect(sameDay.dailyTss.get('2025-03-01')).toBe(200)
  })

  it('loadBetween over the whole span equals the sum of daily load', () => {
    const total = series.days.reduce((s, d) => s + d.tss, 0)
    expect(loadBetween(series, new Date('2025-03-01T00:00:00'), new Date('2025-03-11T00:00:00'))).toBe(total)
    expect(total).toBe(150) // 100 for the hour, 50 for the half hour
  })

  it('loadBetween is half-open — the end date is excluded', () => {
    expect(loadBetween(series, new Date('2025-03-01T00:00:00'), new Date('2025-03-03T00:00:00'))).toBe(100)
    expect(loadBetween(series, new Date('2025-03-03T00:00:00'), new Date('2025-03-04T00:00:00'))).toBe(50)
  })
})

describe('fitnessSeries — FTP history applies per day', () => {
  it('scores each ride against the FTP in effect on its date', () => {
    const history = [
      { date: '2020-01-01', ftp: 200 },
      { date: '2025-03-02', ftp: 250 },
    ]
    const series = fitnessSeries(
      [
        makeRide({ id: 1, average_watts: 200, moving_time: 3600, start_date_local: '2025-03-01T09:00:00' }),
        makeRide({ id: 2, average_watts: 200, moving_time: 3600, start_date_local: '2025-03-05T09:00:00' }),
      ],
      { ftpHistory: history, thresholds: powerOnly },
      TODAY
    )
    // 200 W against FTP 200 → 100. The same ride against FTP 250 → 64.
    expect(series.dailyTss.get('2025-03-01')).toBe(100)
    expect(series.dailyTss.get('2025-03-05')).toBe(64)
  })

  it('ignores the ftp field on the thresholds it is handed', () => {
    // thresholds.ftp is overwritten per-day from the history, so a caller
    // passing a different one cannot shift the curve.
    const a = fitnessSeries(
      [makeRide({ average_watts: 200, moving_time: 3600 })],
      { ftpHistory: ftp200, thresholds: { ...powerOnly, ftp: 999 } },
      TODAY
    )
    const b = fitnessSeries(
      [makeRide({ average_watts: 200, moving_time: 3600 })],
      { ftpHistory: ftp200, thresholds: powerOnly },
      TODAY
    )
    expect(a.days[0].tss).toBe(b.days[0].tss)
  })
})
