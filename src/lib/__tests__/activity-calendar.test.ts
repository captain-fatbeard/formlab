import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import type { FitnessSeries } from '~/lib/fitness'
import {
  buildActivityCalendar,
  levelFor,
  levelThresholds,
  streaks,
  type CalendarDay,
} from '~/lib/activity-calendar'

function ride(day: string, overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: Math.floor(Math.random() * 1e9),
    name: 'Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: `${day}T08:00:00Z`,
    start_date_local: `${day}T10:00:00`,
    distance: 30000,
    moving_time: 3600,
    elapsed_time: 3700,
    total_elevation_gain: 200,
    average_speed: 8.33,
    max_speed: 12,
    ...overrides,
  }
}

function fitness(loads: Record<string, number> = {}): FitnessSeries {
  return { days: [], dailyTss: new Map(Object.entries(loads)), latest: null }
}

const FROM = new Date('2026-01-05T00:00:00') // a Monday
const TO = new Date('2026-01-18T00:00:00') // the Sunday two weeks later

describe('levelThresholds / levelFor', () => {
  it('puts an empty day at level 0 whatever the thresholds', () => {
    expect(levelFor(0, [10, 20, 30])).toBe(0)
    expect(levelFor(0, [0, 0, 0])).toBe(0)
  })

  it('ignores empty days when computing quartiles', () => {
    // Only the non-zero values should shape the ramp — otherwise a mostly-rest
    // period pushes every real day into the top bucket.
    expect(levelThresholds([0, 0, 0, 10, 20, 30, 40])).toEqual(
      levelThresholds([10, 20, 30, 40])
    )
  })

  it('spreads real values across all four levels', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80]
    const t = levelThresholds(values)
    const levels = values.map((v) => levelFor(v, t))
    expect(new Set(levels)).toEqual(new Set([1, 2, 3, 4]))
  })

  it('survives a period with a single active day', () => {
    const t = levelThresholds([50])
    expect(levelFor(50, t)).toBe(1)
    expect(levelFor(0, t)).toBe(0)
  })

  it('survives a period with no activity at all', () => {
    expect(levelThresholds([0, 0])).toEqual([0, 0, 0])
    expect(levelFor(0, [0, 0, 0])).toBe(0)
  })
})

describe('streaks', () => {
  const day = (count: number): CalendarDay => ({
    date: '2026-01-01', activities: [], count,
    movingTime: 0, distance: 0, elevation: 0, load: 0, level: 0,
  })

  it('finds the longest run of active days', () => {
    expect(streaks([1, 1, 1, 0, 1, 1].map(day)).longest).toBe(3)
  })

  it('reports the current run counting back from the end', () => {
    expect(streaks([1, 0, 1, 1].map(day)).current).toBe(2)
  })

  it('does not break the current streak on a still-empty today', () => {
    // Yesterday and the day before were active; today hasn't happened yet.
    expect(streaks([1, 1, 0].map(day)).current).toBe(2)
  })

  it('is zero for no activity', () => {
    expect(streaks([0, 0, 0].map(day))).toEqual({ longest: 0, current: 0 })
  })
})

describe('buildActivityCalendar — the grid', () => {
  it('emits Monday-start columns of seven days', () => {
    const cal = buildActivityCalendar([], fitness(), FROM, TO)
    expect(cal.weeks).toHaveLength(2)
    for (const week of cal.weeks) expect(week).toHaveLength(7)
  })

  it('pads days outside the range with null so columns keep their shape', () => {
    // Start on a Wednesday — Mon and Tue of that column are outside the range.
    const cal = buildActivityCalendar([], fitness(), new Date('2026-01-07T00:00:00'), TO)
    expect(cal.weeks[0][0]).toBeNull()
    expect(cal.weeks[0][1]).toBeNull()
    expect(cal.weeks[0][2]).not.toBeNull()
  })

  it('gives every day in range a cell, active or not', () => {
    const cal = buildActivityCalendar([ride('2026-01-07')], fitness(), FROM, TO)
    const cells = cal.weeks.flat().filter((d): d is CalendarDay => d != null)
    expect(cells).toHaveLength(14)
    expect(cells.filter((d) => d.count > 0)).toHaveLength(1)
  })

  it('labels a month once, on the column it starts in', () => {
    const cal = buildActivityCalendar([], fitness(), FROM, new Date('2026-02-15T00:00:00'))
    const labels = cal.monthLabels.map((m) => m.label)
    expect(labels).toEqual(['Jan', 'Feb'])
  })
})

describe('buildActivityCalendar — aggregation', () => {
  it('rolls several activities on one day into a single cell', () => {
    const cal = buildActivityCalendar(
      [
        ride('2026-01-07', { moving_time: 3600, distance: 30000, total_elevation_gain: 100 }),
        ride('2026-01-07', { moving_time: 1800, distance: 15000, total_elevation_gain: 50 }),
      ],
      fitness({ '2026-01-07': 90 }),
      FROM, TO
    )
    const cell = cal.weeks.flat().find((d) => d?.date === '2026-01-07')!
    expect(cell.count).toBe(2)
    expect(cell.movingTime).toBe(5400)
    expect(cell.distance).toBe(45000)
    expect(cell.elevation).toBe(150)
    expect(cell.load).toBe(90) // from the curve, not re-derived
  })

  it('buckets by local date, not UTC', () => {
    // 00:30 local on the 8th is still the 7th in UTC.
    const cal = buildActivityCalendar(
      [ride('2026-01-08', { start_date: '2026-01-07T23:30:00Z', start_date_local: '2026-01-08T00:30:00' })],
      fitness(), FROM, TO
    )
    expect(cal.weeks.flat().find((d) => d?.date === '2026-01-08')!.count).toBe(1)
    expect(cal.weeks.flat().find((d) => d?.date === '2026-01-07')!.count).toBe(0)
  })

  it('reads load from the fitness curve so the grid matches the chart', () => {
    const cal = buildActivityCalendar(
      [ride('2026-01-07')],
      fitness({ '2026-01-07': 137 }),
      FROM, TO
    )
    expect(cal.weeks.flat().find((d) => d?.date === '2026-01-07')!.load).toBe(137)
  })
})

describe('buildActivityCalendar — metric choice', () => {
  // The reason the grid isn't coloured by activity count: a long easy ride and
  // a short hard one are one activity each, but they are not the same day.
  const activities = [
    ride('2026-01-06', { moving_time: 10800 }), // 3h easy
    ride('2026-01-08', { moving_time: 2400 }), // 40min hard
  ]
  const loads = fitness({ '2026-01-06': 140, '2026-01-08': 60 })

  it('ranks the long ride higher on time', () => {
    const cal = buildActivityCalendar(activities, loads, FROM, TO, 'time')
    const long = cal.weeks.flat().find((d) => d?.date === '2026-01-06')!
    const short = cal.weeks.flat().find((d) => d?.date === '2026-01-08')!
    expect(long.level).toBeGreaterThan(short.level)
    expect(cal.summary.best!.date).toBe('2026-01-06')
  })

  it('switching the metric re-levels the same days', () => {
    const byTime = buildActivityCalendar(activities, loads, FROM, TO, 'time')
    const byLoad = buildActivityCalendar(activities, loads, FROM, TO, 'load')
    // Same cells, potentially different shading — the levels are derived from
    // the chosen metric, not baked into the day.
    expect(byTime.weeks.flat().length).toBe(byLoad.weeks.flat().length)
    expect(byLoad.metric).toBe('load')
    expect(byTime.metric).toBe('time')
  })

  it('never gives an active day level 0', () => {
    const cal = buildActivityCalendar(activities, loads, FROM, TO, 'load')
    for (const d of cal.weeks.flat()) {
      if (d && d.count > 0 && d.load > 0) expect(d.level).toBeGreaterThan(0)
    }
  })
})

describe('buildActivityCalendar — summary', () => {
  const cal = buildActivityCalendar(
    [
      ride('2026-01-06', { moving_time: 3600, distance: 30000, total_elevation_gain: 100 }),
      ride('2026-01-07', { moving_time: 1800, distance: 15000, total_elevation_gain: 50 }),
      ride('2026-01-07', { moving_time: 1800, distance: 10000, total_elevation_gain: 25 }),
    ],
    fitness({ '2026-01-06': 100, '2026-01-07': 80 }),
    FROM, TO
  )

  it('counts activities and active days separately', () => {
    expect(cal.summary.activities).toBe(3)
    expect(cal.summary.activeDays).toBe(2) // the double day is still one day
  })

  it('totals time, distance and elevation across the period', () => {
    expect(cal.summary.movingTime).toBe(7200)
    expect(cal.summary.distance).toBe(55000)
    expect(cal.summary.elevation).toBe(175)
  })

  it('totals load from the curve', () => {
    expect(cal.summary.load).toBe(180)
  })

  it('counts every day in the period, not only the active ones', () => {
    expect(cal.summary.days).toBe(14)
  })

  it('has no best day when nothing happened', () => {
    expect(buildActivityCalendar([], fitness(), FROM, TO).summary.best).toBeNull()
  })
})
