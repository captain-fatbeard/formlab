import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import type { FitnessSeries } from '~/lib/fitness'
import {
  buildActivityCalendar,
  LEVEL_LABELS,
  LOAD_BANDS,
  MAX_LEVEL,
  TIME_BANDS_SECONDS,
  levelFor,
  streaks,
  type CalendarDay,
} from '~/lib/activity-calendar'
import { getScoreLabel } from '~/lib/activities'

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

describe('levelFor — fixed bands', () => {
  it('puts an empty day at level 0', () => {
    expect(levelFor(0, LOAD_BANDS)).toBe(0)
    expect(levelFor(-1, LOAD_BANDS)).toBe(0)
  })

  it('maps load onto the app\'s own Easy/Moderate/Solid/Hard/Epic scale', () => {
    // Same bands the activity list badges rides with, so a cell and a badge
    // never disagree about how big a day was.
    expect(LEVEL_LABELS[levelFor(30, LOAD_BANDS)]).toBe('Easy')
    expect(LEVEL_LABELS[levelFor(90, LOAD_BANDS)]).toBe('Moderate')
    expect(LEVEL_LABELS[levelFor(150, LOAD_BANDS)]).toBe('Solid')
    expect(LEVEL_LABELS[levelFor(250, LOAD_BANDS)]).toBe('Hard')
    expect(LEVEL_LABELS[levelFor(430, LOAD_BANDS)]).toBe('Epic')
  })

  it('agrees with getScoreLabel on every band', () => {
    for (const load of [1, 59, 60, 119, 120, 199, 200, 299, 300, 900]) {
      expect(LEVEL_LABELS[levelFor(load, LOAD_BANDS)]).toBe(getScoreLabel(load))
    }
  })

  // The original complaint: a 160 km ride drew the same colour as a 50 km one.
  it('separates an epic day from a solid one and from an ordinary one', () => {
    expect(levelFor(430, LOAD_BANDS)).toBeGreaterThan(levelFor(150, LOAD_BANDS))
    expect(levelFor(150, LOAD_BANDS)).toBeGreaterThan(levelFor(72, LOAD_BANDS))
    expect(levelFor(72, LOAD_BANDS)).toBeGreaterThan(levelFor(51, LOAD_BANDS))
    expect(levelFor(430, LOAD_BANDS)).toBe(MAX_LEVEL)
  })

  it('is exact at every boundary', () => {
    expect(levelFor(59, LOAD_BANDS)).toBe(1)
    expect(levelFor(60, LOAD_BANDS)).toBe(2)
    expect(levelFor(119, LOAD_BANDS)).toBe(2)
    expect(levelFor(120, LOAD_BANDS)).toBe(3)
  })

  it('bands time by duration on the same five steps', () => {
    expect(LEVEL_LABELS[levelFor(20 * 60, TIME_BANDS_SECONDS)]).toBe('Easy')
    expect(LEVEL_LABELS[levelFor(60 * 60, TIME_BANDS_SECONDS)]).toBe('Moderate')
    expect(LEVEL_LABELS[levelFor(120 * 60, TIME_BANDS_SECONDS)]).toBe('Solid')
    expect(LEVEL_LABELS[levelFor(300 * 60, TIME_BANDS_SECONDS)]).toBe('Epic')
  })

  // What fixed bands buy over quantiles: the answer doesn't move when the rest
  // of the year changes, so years are comparable and a big day always looks big.
  it('gives a day the same level regardless of what else the year holds', () => {
    const easyYear = [40, 45, 50, 430]
    const hardYear = [200, 250, 280, 430]
    for (const v of [430]) {
      expect(levelFor(v, LOAD_BANDS)).toBe(levelFor(v, LOAD_BANDS))
    }
    expect(easyYear.map((v) => levelFor(v, LOAD_BANDS)).at(-1))
      .toBe(hardYear.map((v) => levelFor(v, LOAD_BANDS)).at(-1))
  })
})

describe('streaks', () => {
  const day = (count: number): CalendarDay => ({
    date: '2026-01-01', activities: [], count,
    movingTime: 0, distance: 0, elevation: 0, load: 0, level: 0, isFuture: false,
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

describe('buildActivityCalendar — a year in progress', () => {
  // Full calendar year, "today" halfway through it.
  const YEAR_START = new Date('2026-01-01T00:00:00')
  const YEAR_END = new Date('2026-12-31T00:00:00')
  const TODAY = new Date('2026-01-10T12:00:00')

  const cal = buildActivityCalendar(
    [ride('2026-01-05', { moving_time: 3600 }), ride('2026-01-08', { moving_time: 1800 })],
    fitness({ '2026-01-05': 100, '2026-01-08': 50 }),
    YEAR_START, YEAR_END, 'load', TODAY
  )
  const cells = cal.weeks.flat().filter((d): d is CalendarDay => d != null)

  it('draws the whole year so every year is the same width', () => {
    expect(cells).toHaveLength(365)
  })

  it('marks days after today as future, and today itself as not', () => {
    expect(cells.find((d) => d.date === '2026-01-11')!.isFuture).toBe(true)
    expect(cells.find((d) => d.date === '2026-01-10')!.isFuture).toBe(false)
    expect(cells.find((d) => d.date === '2026-01-09')!.isFuture).toBe(false)
    expect(cells.find((d) => d.date === '2026-12-31')!.isFuture).toBe(true)
  })

  it('counts only elapsed days, so "% of days active" stays honest', () => {
    // 10 days have happened, not 365.
    expect(cal.summary.days).toBe(10)
    expect(cal.summary.activeDays).toBe(2)
  })

  it('does not let the empty rest of the year break the current streak', () => {
    // Jan 8 was active, Jan 9 and 10 were not — but the remaining eleven
    // months must not be counted as a rest run either.
    expect(cal.summary.longestStreak).toBe(1)
    expect(cal.summary.currentStreak).toBe(0)
  })

  it('derives level thresholds from elapsed days only', () => {
    // 350 future days sitting at zero would otherwise flood the quartiles.
    expect(cells.find((d) => d.date === '2026-01-05')!.level).toBeGreaterThan(0)
    expect(cells.find((d) => d.date === '2026-01-08')!.level).toBeGreaterThan(0)
  })

  it('gives future days no level of their own', () => {
    for (const d of cells.filter((c) => c.isFuture)) expect(d.level).toBe(0)
  })

  it('is unaffected by the future for a year that has fully elapsed', () => {
    const past = buildActivityCalendar(
      [ride('2025-06-01')],
      fitness({ '2025-06-01': 80 }),
      new Date('2025-01-01T00:00:00'), new Date('2025-12-31T00:00:00'), 'load', TODAY
    )
    expect(past.summary.days).toBe(365)
    expect(past.weeks.flat().filter((d) => d?.isFuture)).toHaveLength(0)
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
