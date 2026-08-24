import { describe, it, expect } from 'vitest'
import { weekChanges } from '../week-changes'
import type { StravaActivity } from '../strava'
import type { FitnessSeries } from '../fitness'
import type { WeightEntry } from '../storage/supabase-client'

const NOW = new Date('2026-08-24T12:00:00')

function activity(daysAgo: number, movingTime: number): StravaActivity {
  const date = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()
  return {
    id: daysAgo,
    name: `Ride ${daysAgo}`,
    type: 'Ride',
    sport_type: 'Ride',
    start_date: date,
    start_date_local: date,
    distance: 30_000,
    moving_time: movingTime,
    elapsed_time: movingTime,
    total_elevation_gain: 100,
    average_speed: 8,
    max_speed: 14,
  } as StravaActivity
}

function series(dailyTss: Record<string, number>, latest = { ctl: 60, atl: 70, tsb: -10 }): FitnessSeries {
  const days = Object.entries(dailyTss).map(([date, tss]) => ({
    date,
    tss,
    ctl: 60,
    atl: 70,
    tsb: -10,
    ftp: 250,
  }))
  // Eight days of history so the "a week ago" lookup has something to find.
  const padded = [...days]
  while (padded.length < 9) padded.unshift({ date: '2026-08-01', tss: 0, ctl: 55, atl: 60, tsb: -5, ftp: 250 })
  return {
    days: padded,
    dailyTss: new Map(Object.entries(dailyTss)),
    latest: { date: '2026-08-24', tss: 0, ftp: 250, ...latest },
  }
}

describe('weekChanges', () => {
  it('compares this week against the one before it', () => {
    const fitness = series({
      '2026-08-20': 100, // this week
      '2026-08-21': 50,
      '2026-08-14': 100, // the week before
      '2026-08-15': 25,
    })
    const changes = weekChanges([], fitness, [], NOW)
    const load = changes.find((c) => c.id === 'load')!
    expect(load.value).toBe('150 TSS')
    expect(load.delta).toBe('+20%')
    expect(load.tone).toBe('up')
  })

  it('says nothing rather than dividing by an empty week', () => {
    const changes = weekChanges([], series({ '2026-08-20': 100 }), [], NOW)
    expect(changes.find((c) => c.id === 'load')!.delta).toBeNull()
    expect(changes.find((c) => c.id === 'hours')!.delta).toBeNull()
  })

  it('counts hours from the activities in each window', () => {
    const activities = [activity(2, 7200), activity(4, 3600), activity(9, 3600)]
    const changes = weekChanges(activities, series({}), [], NOW)
    const hours = changes.find((c) => c.id === 'hours')!
    expect(hours.value).toBe('3.0 h')
    expect(hours.delta).toBe('+2 h')
    expect(hours.hint).toBe('2 activities this week')
  })

  it('reports form as a state with a weekly delta', () => {
    const fitness = series({}, { ctl: 62, atl: 45, tsb: 17 })
    const form = weekChanges([], fitness, [], NOW).find((c) => c.id === 'form')!
    expect(form.value).toBe('+17')
    expect(form.hint).toBe('Fitness 62, fatigue 45')
  })

  it('compares weight against four weeks back, when there is a reading', () => {
    const entries: WeightEntry[] = [
      { id: '1', weight: 79.4, recordedAt: '2026-08-22T07:00:00Z' },
      { id: '2', weight: 81.0, recordedAt: '2026-07-20T07:00:00Z' },
    ] as WeightEntry[]
    const weight = weekChanges([], series({}), entries, NOW).find((c) => c.id === 'weight')!
    expect(weight.value).toBe('79.4 kg')
    expect(weight.delta).toBe('-1.6 kg')
    expect(weight.tone).toBe('down')
  })

  it('leaves weight out entirely when nothing has been logged', () => {
    expect(weekChanges([], series({}), [], NOW).some((c) => c.id === 'weight')).toBe(false)
  })
})
