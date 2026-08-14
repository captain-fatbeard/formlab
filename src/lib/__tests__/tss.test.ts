import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import {
  calculateTSS,
  classifySport,
  deriveThresholds,
  gapFactor,
  gradeAdjustedSpeed,
  type TssThresholds,
} from '~/lib/tss'
import { INTERVALS_ID_OFFSET } from '~/lib/intervals'

function makeActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Test',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2026-04-01T08:00:00Z',
    start_date_local: '2026-04-01T10:00:00',
    distance: 30000,
    moving_time: 3600,
    elapsed_time: 3700,
    total_elevation_gain: 0,
    average_speed: 8.33,
    max_speed: 10,
    ...overrides,
  }
}

const athlete = { ftp: 250, maxHR: 195, restingHR: 50 }

const fullThresholds: TssThresholds = {
  ftp: 250,
  cyclingLTHR: 165,
  runningLTHR: 175,
  runningThresholdPace: 4.0, // m/s ≈ 4:10/km
  maxHR: 195,
  restingHR: 50,
}

describe('classifySport', () => {
  it('treats Ride and VirtualRide as cycling', () => {
    expect(classifySport(makeActivity({ type: 'Ride', sport_type: 'Ride' }))).toBe('cycling')
    expect(classifySport(makeActivity({ type: 'VirtualRide', sport_type: 'VirtualRide' }))).toBe('cycling')
    expect(classifySport(makeActivity({ type: 'Ride', sport_type: 'GravelRide' }))).toBe('cycling')
    expect(classifySport(makeActivity({ type: 'Ride', sport_type: 'MountainBikeRide' }))).toBe('cycling')
  })

  it('treats Run / TrailRun / VirtualRun as running', () => {
    expect(classifySport(makeActivity({ type: 'Run', sport_type: 'Run' }))).toBe('running')
    expect(classifySport(makeActivity({ type: 'Run', sport_type: 'TrailRun' }))).toBe('running')
    expect(classifySport(makeActivity({ type: 'VirtualRun', sport_type: 'VirtualRun' }))).toBe('running')
  })

  it('treats Walk, Swim, WeightTraining as other', () => {
    expect(classifySport(makeActivity({ type: 'Walk', sport_type: 'Walk' }))).toBe('other')
    expect(classifySport(makeActivity({ type: 'Swim', sport_type: 'Swim' }))).toBe('other')
    expect(classifySport(makeActivity({ type: 'WeightTraining', sport_type: 'WeightTraining' }))).toBe('other')
  })
})

describe('gapFactor', () => {
  it('returns 1 on flat ground', () => {
    expect(gapFactor(0, 10000)).toBe(1)
  })

  it('returns 1 for zero distance', () => {
    expect(gapFactor(100, 0)).toBe(1)
  })

  it('increases with elevation gain at fixed distance', () => {
    const flat = gapFactor(0, 10000)
    const some = gapFactor(100, 10000)
    const more = gapFactor(300, 10000)
    expect(some).toBeGreaterThan(flat)
    expect(more).toBeGreaterThan(some)
  })

  it('a 5% net gain over 10k yields a meaningful but bounded factor', () => {
    const f = gapFactor(500, 10000)
    expect(f).toBeGreaterThan(1.05)
    expect(f).toBeLessThan(1.30)
  })
})

describe('gradeAdjustedSpeed', () => {
  it('equals average_speed on flat ground', () => {
    const flat = makeActivity({ average_speed: 4.0, total_elevation_gain: 0, distance: 10000 })
    expect(gradeAdjustedSpeed(flat)).toBe(4.0)
  })

  it('exceeds average_speed on a hilly route', () => {
    const hilly = makeActivity({ average_speed: 4.0, total_elevation_gain: 200, distance: 10000 })
    expect(gradeAdjustedSpeed(hilly)).toBeGreaterThan(4.0)
  })
})

describe('calculateTSS — reported intervals.icu load', () => {
  const intervalsRide = (overrides: Partial<StravaActivity> = {}) =>
    makeActivity({ id: INTERVALS_ID_OFFSET + 164403937, ...overrides })

  it('prefers the reported load over the power estimate', () => {
    // Power says 100; the stream-derived load says 72 and wins.
    const a = intervalsRide({ moving_time: 3600, average_watts: 250, suffer_score: 72 })
    expect(calculateTSS(a, fullThresholds)).toBe(72)
  })

  it('ignores Strava Relative Effort on Strava-sourced activities', () => {
    // Same field, unrelated scale — must fall through to the power estimate.
    const a = makeActivity({ moving_time: 3600, average_watts: 250, suffer_score: 72 })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('falls through when intervals.icu reported no load', () => {
    const a = intervalsRide({ moving_time: 3600, average_watts: 250, suffer_score: 0 })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('separates two rides with equal average power but different loads', () => {
    // The case that started this: same avg watts, very different normalized power.
    const hilly = intervalsRide({ moving_time: 4041, average_watts: 171, suffer_score: 72 })
    const steady = intervalsRide({ moving_time: 3909, average_watts: 170, suffer_score: 51 })
    expect(calculateTSS(hilly, fullThresholds)).toBe(72)
    expect(calculateTSS(steady, fullThresholds)).toBe(51)
  })
})

describe('calculateTSS — power TSS (cycling)', () => {
  it('returns 0 when no power data and no LTHR', () => {
    const a = makeActivity()
    expect(calculateTSS(a, { ...fullThresholds, cyclingLTHR: null })).toBe(0)
  })

  it('returns 100 for 1 hour at FTP', () => {
    const a = makeActivity({ moving_time: 3600, average_watts: 250 })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('uses weighted_average_watts when available', () => {
    const a = makeActivity({
      moving_time: 3600,
      average_watts: 200,
      weighted_average_watts: 250,
    })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('scales with duration squared… no, linearly with duration at fixed IF', () => {
    const short = makeActivity({ moving_time: 1800, average_watts: 250 })
    const long = makeActivity({ moving_time: 3600, average_watts: 250 })
    expect(calculateTSS(long, fullThresholds)).toBe(2 * calculateTSS(short, fullThresholds))
  })
})

describe('calculateTSS — hrTSS fallback (cycling without power)', () => {
  it('uses cycling LTHR when ride has HR but no power', () => {
    const a = makeActivity({
      moving_time: 3600,
      average_heartrate: 165, // exactly LTHR → IF = 1.0
    })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('returns less than 100 below LTHR', () => {
    const a = makeActivity({ moving_time: 3600, average_heartrate: 132 }) // 0.8 × LTHR
    const tss = calculateTSS(a, fullThresholds)
    expect(tss).toBeGreaterThan(60)
    expect(tss).toBeLessThan(70)
  })

  it('clamps IF at 1.15', () => {
    const a = makeActivity({ moving_time: 3600, average_heartrate: 250 })
    expect(calculateTSS(a, fullThresholds)).toBeLessThanOrEqual(133)
  })
})

describe('calculateTSS — running with pace', () => {
  it('uses pace-based rTSS when running threshold pace is known', () => {
    const a = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 4.0, // exactly threshold → IF = 1.0
      total_elevation_gain: 0,
      distance: 14400,
    })
    expect(calculateTSS(a, fullThresholds)).toBe(100)
  })

  it('rewards harder running with more TSS', () => {
    const easy = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 3.0,
      distance: 10800,
    })
    const fast = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 4.0,
      distance: 14400,
    })
    expect(calculateTSS(fast, fullThresholds)).toBeGreaterThan(calculateTSS(easy, fullThresholds))
  })

  it('hilly run earns more TSS than flat run at same recorded pace', () => {
    const flat = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 3.5,
      total_elevation_gain: 0,
      distance: 12600,
    })
    const hilly = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 3.5,
      total_elevation_gain: 400,
      distance: 12600,
    })
    expect(calculateTSS(hilly, fullThresholds)).toBeGreaterThan(calculateTSS(flat, fullThresholds))
  })
})

describe('calculateTSS — running without pace, with HR', () => {
  it('falls back to running LTHR hrTSS when threshold pace is missing', () => {
    const t: TssThresholds = { ...fullThresholds, runningThresholdPace: null }
    const a = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 0,
      average_heartrate: 175,
    })
    expect(calculateTSS(a, t)).toBe(100)
  })

  it('returns 0 when neither pace nor HR is available', () => {
    const t: TssThresholds = { ...fullThresholds, runningThresholdPace: null }
    const a = makeActivity({
      type: 'Run',
      sport_type: 'Run',
      moving_time: 3600,
      average_speed: 0,
    })
    expect(calculateTSS(a, t)).toBe(0)
  })
})

describe('calculateTSS — non-tracked sports', () => {
  it('returns 0 for Walk', () => {
    const a = makeActivity({ type: 'Walk', sport_type: 'Walk', average_heartrate: 130 })
    expect(calculateTSS(a, fullThresholds)).toBe(0)
  })

  it('returns 0 for WeightTraining', () => {
    const a = makeActivity({ type: 'WeightTraining', sport_type: 'WeightTraining', average_heartrate: 130 })
    expect(calculateTSS(a, fullThresholds)).toBe(0)
  })
})

describe('deriveThresholds', () => {
  const now = new Date('2026-05-01T12:00:00')

  function ride(daysAgo: number, opts: Partial<StravaActivity>): StravaActivity {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    return makeActivity({
      type: 'Ride',
      sport_type: 'Ride',
      start_date: d.toISOString(),
      start_date_local: d.toISOString(),
      ...opts,
    })
  }

  function run(daysAgo: number, opts: Partial<StravaActivity>): StravaActivity {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    return makeActivity({
      type: 'Run',
      sport_type: 'Run',
      start_date: d.toISOString(),
      start_date_local: d.toISOString(),
      ...opts,
    })
  }

  it('falls back to maxHR-based estimates when no qualifying efforts', () => {
    const { thresholds, sources } = deriveThresholds([], athlete, now)
    expect(thresholds.cyclingLTHR).toBe(Math.round(195 * 0.85))
    expect(thresholds.runningLTHR).toBe(Math.round(195 * 0.89))
    expect(thresholds.runningThresholdPace).toBeNull()
    expect(sources.cyclingLTHR).toBe('estimated')
    expect(sources.runningLTHR).toBe('estimated')
    expect(sources.runningThresholdPace).toBe('unavailable')
  })

  it('derives cycling LTHR from top long-ride avg HR', () => {
    const acts = [
      ride(1, { moving_time: 3600, average_heartrate: 168 }),
      ride(5, { moving_time: 3600, average_heartrate: 162 }),
      ride(10, { moving_time: 3600, average_heartrate: 158 }),
      ride(20, { moving_time: 3600, average_heartrate: 130 }), // easy ride
      ride(30, { moving_time: 600, average_heartrate: 180 }), // too short — ignored
    ]
    const { thresholds, sources } = deriveThresholds(acts, athlete, now)
    // top 3 of [168, 162, 158, 130] → avg = 162.67 → 163
    expect(thresholds.cyclingLTHR).toBe(163)
    expect(sources.cyclingLTHR).toBe('derived')
  })

  it('derives running LTHR and threshold pace separately from cycling', () => {
    const acts = [
      run(1, { moving_time: 1800, average_heartrate: 178, distance: 6500, average_speed: 3.6 }),
      run(5, { moving_time: 1800, average_heartrate: 172, distance: 6300, average_speed: 3.5 }),
      run(10, { moving_time: 1800, average_heartrate: 170, distance: 6000, average_speed: 3.3 }),
    ]
    const { thresholds, sources } = deriveThresholds(acts, athlete, now)
    expect(thresholds.runningLTHR).toBe(173) // (178+172+170)/3
    expect(thresholds.runningThresholdPace).toBeGreaterThan(3.4)
    expect(sources.runningLTHR).toBe('derived')
    expect(sources.runningThresholdPace).toBe('derived')
  })

  it('ignores activities older than the derivation window', () => {
    const acts = [
      ride(200, { moving_time: 3600, average_heartrate: 180 }),
      ride(210, { moving_time: 3600, average_heartrate: 178 }),
      ride(220, { moving_time: 3600, average_heartrate: 176 }),
    ]
    const { thresholds, sources } = deriveThresholds(acts, athlete, now)
    expect(sources.cyclingLTHR).toBe('estimated') // none within 180 days
    expect(thresholds.cyclingLTHR).toBe(Math.round(195 * 0.85))
  })

  it('requires at least 3 qualifying efforts to derive', () => {
    const acts = [
      ride(1, { moving_time: 3600, average_heartrate: 170 }),
      ride(5, { moving_time: 3600, average_heartrate: 165 }),
    ]
    const { sources } = deriveThresholds(acts, athlete, now)
    expect(sources.cyclingLTHR).toBe('estimated')
  })
})
