import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import { fitnessSeries } from '~/lib/fitness'
import {
  BUILD_PLAN,
  PAUSED_PLAN,
  RECOVERY_PLAN,
  SESSION_CATALOG,
  classifyDerivedPhase,
  computeFit,
  computeWeekStats,
  countWeekShape,
  countsAsOnPlan,
  detectPhase,
  planRecommendations,
  plannedSessionTSS,
  shapeDrift,
  summarizeWeek,
  templateFor,
  tssBandFor,
  type DayActual,
  type PlanSession,
} from '~/lib/plan'

const FTP = 250

function actual(overrides: Partial<DayActual> = {}): DayActual {
  return {
    movingTimeMin: 60,
    avgPower: 160,
    np: 165,
    avgHr: 140,
    distance: 30000,
    activities: [],
    ...overrides,
  }
}

// ===================================================================
// detectPhase — the recovery/build decision
// ===================================================================

describe('detectPhase', () => {
  it('assumes build when there is no fitness data', () => {
    expect(detectPhase(null, null)).toBe('build')
  })

  it('prescribes recovery while form is still negative', () => {
    expect(detectPhase(-4, 20)).toBe('recovery')
  })

  it('prescribes recovery while fatigue is still heavy, even with good form', () => {
    expect(detectPhase(10, 65)).toBe('recovery')
  })

  it('builds once form is neutral and fatigue has come down', () => {
    expect(detectPhase(0, 40)).toBe('build')
  })

  it('is exact at the boundaries', () => {
    expect(detectPhase(-3, 0)).toBe('build') // -3 is not < -3
    expect(detectPhase(-3.1, 0)).toBe('recovery')
    expect(detectPhase(0, 64)).toBe('build')
    expect(detectPhase(0, 65)).toBe('recovery')
  })
})

// ===================================================================
// classifyDerivedPhase
// ===================================================================

describe('classifyDerivedPhase', () => {
  const week = (...types: Array<keyof typeof SESSION_CATALOG>): PlanSession[] =>
    types.map((t) => SESSION_CATALOG[t])

  it('classifies the stock templates', () => {
    expect(classifyDerivedPhase(RECOVERY_PLAN)).toBe('recovery')
    expect(classifyDerivedPhase(BUILD_PLAN)).toBe('build')
    expect(classifyDerivedPhase(PAUSED_PLAN)).toBe('recovery')
  })

  it('needs three hard days for peak', () => {
    expect(classifyDerivedPhase(week('threshold', 'vo2', 'z2'))).toBe('build')
    expect(classifyDerivedPhase(week('threshold', 'vo2', 'threshold'))).toBe('peak')
  })

  it('does not let tempo runs alone reach peak', () => {
    // Three tempo runs is still a build week; three threshold/VO2 days is peak.
    expect(classifyDerivedPhase(week('tempo-run', 'tempo-run', 'tempo-run'))).toBe('recovery')
    expect(classifyDerivedPhase(week('tempo', 'tempo', 'tempo'))).toBe('recovery')
  })
})

// ===================================================================
// computeFit — the eight-way verdict
// ===================================================================

describe('computeFit — rest days', () => {
  const rest = SESSION_CATALOG.rest

  it('is on target when nothing was ridden', () => {
    expect(computeFit(rest, null, FTP)).toBe('on-target')
  })

  it('allows a short easy spin', () => {
    expect(computeFit(rest, actual({ movingTimeMin: 25, avgPower: 100 }), FTP)).toBe('on-target')
  })

  it('flags a spin that ran long', () => {
    expect(computeFit(rest, actual({ movingTimeMin: 45, avgPower: 100 }), FTP)).toBe('rest-skipped')
  })

  it('flags a spin that was too hard', () => {
    // 0.5 x 250 = 125 W ceiling for a compliant spin
    expect(computeFit(rest, actual({ movingTimeMin: 25, avgPower: 130 }), FTP)).toBe('rest-skipped')
  })
})

describe('computeFit — training days', () => {
  const threshold = SESSION_CATALOG.threshold // 40–85 min, 0.70–1.05 x FTP

  it('is missed when nothing was ridden', () => {
    expect(computeFit(threshold, null, FTP)).toBe('none')
  })

  it('checks duration before power', () => {
    // Too long AND too hard — duration is reported.
    expect(computeFit(threshold, actual({ movingTimeMin: 120, avgPower: 300 }), FTP)).toBe('over-duration')
  })

  it('reports over- and under-duration', () => {
    expect(computeFit(threshold, actual({ movingTimeMin: 90 }), FTP)).toBe('over-duration')
    expect(computeFit(threshold, actual({ movingTimeMin: 30 }), FTP)).toBe('under-duration')
  })

  it('reports above and below the power band', () => {
    expect(computeFit(threshold, actual({ movingTimeMin: 60, avgPower: 270 }), FTP)).toBe('above')
    expect(computeFit(threshold, actual({ movingTimeMin: 60, avgPower: 150 }), FTP)).toBe('below')
  })

  it('is on target inside both bands', () => {
    expect(computeFit(threshold, actual({ movingTimeMin: 60, avgPower: 220 }), FTP)).toBe('on-target')
  })

  it('does not judge power when the session is not power-constrained', () => {
    // A test ride has no floor or ceiling.
    expect(computeFit(SESSION_CATALOG.test, actual({ movingTimeMin: 60, avgPower: 400 }), FTP)).toBe('on-target')
  })

  it('does not judge power when the ride has none', () => {
    expect(computeFit(threshold, actual({ movingTimeMin: 60, avgPower: null }), FTP)).toBe('on-target')
  })
})

describe('countsAsOnPlan — the adherence rule', () => {
  const day = (verdict: string, session: PlanSession) =>
    ({ verdict, session } as Parameters<typeof countsAsOnPlan>[0])

  it('counts on-target and short days', () => {
    expect(countsAsOnPlan(day('on-target', SESSION_CATALOG.z2))).toBe(true)
    expect(countsAsOnPlan(day('under-duration', SESSION_CATALOG.z2))).toBe(true)
  })

  it('counts an easy day only where the session allows going easy', () => {
    expect(countsAsOnPlan(day('below', SESSION_CATALOG.z2))).toBe(true) // allowBelow
    expect(countsAsOnPlan(day('below', SESSION_CATALOG.threshold))).toBe(false)
  })

  it('never counts missed, skipped or over-cooked days', () => {
    for (const v of ['none', 'rest-skipped', 'above', 'over-duration']) {
      expect(countsAsOnPlan(day(v, SESSION_CATALOG.z2))).toBe(false)
    }
  })
})

// ===================================================================
// templates and week stats
// ===================================================================

describe('templateFor', () => {
  it('returns the phase template unchanged with no overrides', () => {
    expect(templateFor('build')).toEqual(BUILD_PLAN)
    expect(templateFor('recovery')).toEqual(RECOVERY_PLAN)
  })

  it('applies a day override from the catalog', () => {
    const week = templateFor('build', { 0: 'vo2' })
    expect(week[0]).toEqual(SESSION_CATALOG.vo2)
    expect(week[1]).toEqual(BUILD_PLAN[1])
  })

  it('ignores overrides on a paused week — nothing is scheduled to override', () => {
    expect(templateFor('paused', { 0: 'vo2' })).toEqual(PAUSED_PLAN)
  })
})

describe('computeWeekStats', () => {
  it('splits a build week into intensity and easy', () => {
    const stats = computeWeekStats(BUILD_PLAN)
    expect(stats.rest).toBe(2)
    expect(stats.sessions).toBe(5)
    expect(stats.intensity).toBe(2) // threshold + vo2
    expect(stats.easy).toBe(3)
    expect(stats.totalTSS).toBeGreaterThan(0)
  })

  it('counts a recovery week as all easy', () => {
    const stats = computeWeekStats(RECOVERY_PLAN)
    expect(stats.intensity).toBe(0)
    expect(stats.intensityMinutes).toBe(0)
  })

  it('scores a paused week as nothing at all', () => {
    const stats = computeWeekStats(PAUSED_PLAN)
    expect(stats.totalTSS).toBe(0)
    expect(stats.totalMinutes).toBe(0)
    expect(stats.rest).toBe(7)
  })

  it('totals match the per-session planned TSS', () => {
    const expected = BUILD_PLAN.reduce((s, x) => s + plannedSessionTSS(x), 0)
    expect(computeWeekStats(BUILD_PLAN).totalTSS).toBe(expected)
  })
})

describe('countWeekShape / shapeDrift', () => {
  it('the stock templates sit inside their own targets', () => {
    expect(shapeDrift(BUILD_PLAN, 'build')).toEqual([])
    expect(shapeDrift(RECOVERY_PLAN, 'recovery')).toEqual([])
    expect(shapeDrift(PAUSED_PLAN, 'paused')).toEqual([])
  })

  it('tolerates drift of one', () => {
    const week = templateFor('build', { 0: 'vo2' }) // 3 intensity vs target 2
    expect(shapeDrift(week, 'build')).toEqual([])
  })

  it('reports drift beyond one', () => {
    const week = templateFor('build', { 0: 'vo2', 2: 'threshold' }) // 4 intensity
    const drift = shapeDrift(week, 'build')
    expect(drift).toContainEqual({ dimension: 'intensity', actual: 4, expected: 2 })
  })

  it('counts tempo and tempo-run as intensity', () => {
    expect(countWeekShape([SESSION_CATALOG.tempo, SESSION_CATALOG['tempo-run']]).intensity).toBe(2)
  })
})

// ===================================================================
// recommendations
// ===================================================================

describe('tssBandFor', () => {
  it('personalises against CTL when available', () => {
    // maintenance = 60 x 7 = 420; build band is 0.95–1.25
    expect(tssBandFor('build', 60)).toEqual({ min: 399, max: 525, maintenance: 420 })
  })

  it('falls back to absolute ranges with no CTL', () => {
    expect(tssBandFor('build', null)).toEqual({ min: 300, max: 500, maintenance: null })
  })

  it('puts recovery below maintenance and peak above it', () => {
    const ctl = 50
    expect(tssBandFor('recovery', ctl).max).toBeLessThan(ctl * 7)
    expect(tssBandFor('peak', ctl).max).toBeGreaterThan(ctl * 7)
  })
})

describe('planRecommendations', () => {
  const stats = (o: Partial<ReturnType<typeof computeWeekStats>> = {}) => ({
    totalMinutes: 400, totalTSS: 420, sessions: 5, rest: 2,
    intensity: 2, easy: 3, easyMinutes: 300, intensityMinutes: 100,
    ...o,
  })

  it('says the week is fine when everything lines up', () => {
    expect(planRecommendations(stats(), 'build', 60).map((r) => r.kind)).toEqual(['on-plan'])
  })

  it('collapses too-much-intensity plus too-little-volume into one fix', () => {
    const recs = planRecommendations(stats({ intensity: 4, totalTSS: 200 }), 'build', 60)
    expect(recs.map((r) => r.kind)).toContain('intensity-high-volume-low')
    // One coherent fix, not three overlapping nags about the same problem.
    expect(recs.filter((r) => r.kind.startsWith('intensity')).length).toBe(1)
  })

  it('flags intensity alone when volume is fine', () => {
    expect(planRecommendations(stats({ intensity: 4 }), 'build', 60)[0].kind)
      .toMatch(/^intensity-high/)
  })

  it('flags too little intensity for a build week', () => {
    expect(planRecommendations(stats({ intensity: 0, intensityMinutes: 0 }), 'build', 60)[0].kind)
      .toMatch(/^intensity-low/)
  })

  it('flags volume on its own', () => {
    expect(planRecommendations(stats({ totalTSS: 200 }), 'build', 60)[0].kind).toBe('volume-low')
    expect(planRecommendations(stats({ totalTSS: 900 }), 'build', 60)[0].kind).toBe('volume-high')
  })

  it('always adds a rest-day warning when there is no rest day', () => {
    const recs = planRecommendations(stats({ rest: 0 }), 'build', 60)
    expect(recs.map((r) => r.kind)).toContain('no-rest-day')
  })

  it('mentions the CTL maintenance figure only when CTL is known', () => {
    expect(planRecommendations(stats({ totalTSS: 200 }), 'build', 60)[0].message).toContain('maintenance')
    expect(planRecommendations(stats({ totalTSS: 200 }), 'build', null)[0].message).not.toContain('maintenance')
  })

  it('never returns an empty list', () => {
    for (const phase of ['recovery', 'build', 'peak'] as const) {
      expect(planRecommendations(stats(), phase, 60).length).toBeGreaterThan(0)
    }
  })
})

// ===================================================================
// summarizeWeek — the number the whole page is about
// ===================================================================

function makeRide(day: string, overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: Math.floor(Math.random() * 1e6),
    name: 'Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: `${day}T08:00:00Z`,
    start_date_local: `${day}T10:00:00`,
    distance: 40000,
    moving_time: 3600,
    elapsed_time: 3700,
    total_elevation_gain: 200,
    average_speed: 11.1,
    max_speed: 15,
    average_watts: 160,
    ...overrides,
  }
}

const thresholds = {
  ftp: FTP,
  cyclingLTHR: 165,
  runningLTHR: 175,
  runningThresholdPace: null,
  maxHR: 190,
  restingHR: 50,
}

describe('summarizeWeek', () => {
  // Monday 2026-08-03 .. Sunday 2026-08-09, "today" is the Wednesday.
  const weekStart = new Date('2026-08-03T00:00:00')
  const today = new Date('2026-08-05T23:00:00')

  const build = (activities: StravaActivity[], phase: 'build' | 'recovery' | 'paused' = 'build') => {
    const fitness = fitnessSeries(activities, { ftpHistory: [{ date: '2020-01-01', ftp: FTP }], thresholds }, today)
    return summarizeWeek({ weekStart, today, activities, fitness, ftp: FTP, phase })
  }

  it('marks days after today as upcoming and never scores them', () => {
    const week = build([])
    expect(week.days[6].verdict).toBe('future')
    expect(week.days[6].isPastOrToday).toBe(false)
  })

  it('scores a paused week as nothing — riding is not "rest skipped"', () => {
    const week = build([makeRide('2026-08-03', { moving_time: 7200, average_watts: 250 })], 'paused')
    expect(week.days.every((d) => d.verdict === 'paused')).toBe(true)
    expect(week.scoredCount).toBe(0)
    expect(week.adherencePct).toBe(0)
  })

  it('reports 100% adherence when the past days all fit', () => {
    // Build week: Mon z2, Tue threshold, Wed z2.
    const week = build([
      makeRide('2026-08-03', { moving_time: 3600, average_watts: 160 }),
      makeRide('2026-08-04', { moving_time: 3600, average_watts: 230 }),
      makeRide('2026-08-05', { moving_time: 3600, average_watts: 160 }),
    ])
    expect(week.adherencePct).toBe(100)
    expect(week.scoredCount).toBe(3)
  })

  it('drops adherence when a day was missed', () => {
    const week = build([
      makeRide('2026-08-03', { moving_time: 3600, average_watts: 160 }),
      makeRide('2026-08-05', { moving_time: 3600, average_watts: 160 }),
    ])
    // Tuesday's threshold went missing.
    expect(week.days[1].verdict).toBe('none')
    expect(week.adherencePct).toBe(67)
  })

  it('takes the weekly load from the same curve the page draws', () => {
    const activities = [
      makeRide('2026-08-03', { moving_time: 3600, average_watts: 250 }),
      makeRide('2026-08-05', { moving_time: 1800, average_watts: 250 }),
    ]
    const fitness = fitnessSeries(activities, { ftpHistory: [{ date: '2020-01-01', ftp: FTP }], thresholds }, today)
    const week = summarizeWeek({ weekStart, today, activities, fitness, ftp: FTP, phase: 'build' })

    const fromCurve =
      (fitness.dailyTss.get('2026-08-03') ?? 0) + (fitness.dailyTss.get('2026-08-05') ?? 0)
    expect(week.actualTSS).toBe(fromCurve)
    expect(week.actualTSS).toBe(150) // 100 for the hour at FTP, 50 for the half hour
  })

  it('excludes activities from neighbouring weeks', () => {
    const week = build([
      makeRide('2026-08-02', { moving_time: 3600, average_watts: 250 }), // the Sunday before
      makeRide('2026-08-03', { moving_time: 3600, average_watts: 250 }),
    ])
    expect(week.totalActivities).toBe(1)
    expect(week.actualTSS).toBe(100)
  })

  it('applies a day override to the day it names', () => {
    const activities = [makeRide('2026-08-03', { moving_time: 3600, average_watts: 260 })]
    const fitness = fitnessSeries(activities, { ftpHistory: [{ date: '2020-01-01', ftp: FTP }], thresholds }, today)
    const overridden = summarizeWeek({
      weekStart, today, activities, fitness, ftp: FTP, phase: 'build',
      dayOverrides: { 0: 'vo2' },
    })
    expect(overridden.days[0].session.type).toBe('vo2')
    // 260 W sits inside VO2's 162–275 W band...
    expect(overridden.days[0].verdict).toBe('on-target')

    // ...but above Z2's 200 W ceiling, which is what Monday is by default.
    const plain = summarizeWeek({ weekStart, today, activities, fitness, ftp: FTP, phase: 'build' })
    expect(plain.days[0].session.type).toBe('z2')
    expect(plain.days[0].verdict).toBe('above')
  })
})
