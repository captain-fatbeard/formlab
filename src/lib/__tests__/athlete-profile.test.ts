import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import { deriveAthleteProfile } from '~/lib/athlete-profile'
import { calculateTSS } from '~/lib/tss'

const athlete = { weight: 75, maxHR: 190, restingHR: 50 }

function makeRide(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Ride',
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2026-08-01T08:00:00Z',
    start_date_local: '2026-08-01T10:00:00',
    distance: 40000,
    moving_time: 3600,
    elapsed_time: 3700,
    total_elevation_gain: 200,
    average_speed: 11.1,
    max_speed: 15,
    average_watts: 240,
    average_heartrate: 150,
    ...overrides,
  }
}

function makeRun(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return makeRide({
    type: 'Run',
    sport_type: 'Run',
    name: 'Run',
    distance: 12000,
    moving_time: 3000,
    average_speed: 4.0,
    average_watts: undefined,
    average_heartrate: 160,
    ...overrides,
  })
}

/** A history spread across a year: recent rides plus older ones, and runs. */
function fullHistory(): StravaActivity[] {
  const rides = [0, 40, 120, 200, 300].map((daysAgo, i) => {
    const d = new Date('2026-08-14T00:00:00Z')
    d.setDate(d.getDate() - daysAgo)
    const iso = d.toISOString()
    return makeRide({
      id: 100 + i,
      start_date: iso,
      start_date_local: iso.replace('Z', ''),
      // The strongest effort is an old one, so a short window loses it.
      average_watts: daysAgo >= 200 ? 300 : 200,
      moving_time: 3600,
    })
  })
  const runs = [10, 30, 60].map((daysAgo, i) => {
    const d = new Date('2026-08-14T00:00:00Z')
    d.setDate(d.getDate() - daysAgo)
    const iso = d.toISOString()
    return makeRun({ id: 200 + i, start_date: iso, start_date_local: iso.replace('Z', '') })
  })
  return [...rides, ...runs]
}

describe('deriveAthleteProfile — independence from display filters', () => {
  const all = fullHistory()

  it('derives the same FTP from the full history regardless of what a page shows', () => {
    const profile = deriveAthleteProfile(all, athlete)

    // What a 30-day time range would have handed the old code path.
    const cutoff = new Date('2026-07-15T00:00:00Z')
    const last30d = all.filter((a) => new Date(a.start_date) >= cutoff)

    expect(profile.ftp).toBeGreaterThan(0)
    // The point: a profile built from the narrow slice is NOT the profile — the
    // strongest effort sits outside the window, so scoping FTP to the view
    // would silently lower it.
    expect(deriveAthleteProfile(last30d, athlete).ftp).toBeLessThan(profile.ftp)
  })

  it('keeps running threshold pace when the view is filtered to cycling', () => {
    const profile = deriveAthleteProfile(all, athlete)
    expect(profile.thresholds.runningThresholdPace).not.toBeNull()

    // Selecting "Cycling" used to remove the runs deriveThresholds needs, which
    // cost every run its rTSS.
    const ridesOnly = all.filter((a) => a.type !== 'Run')
    expect(deriveAthleteProfile(ridesOnly, athlete).thresholds.runningThresholdPace).toBeNull()
  })

  it('scores a ride identically no matter which view triggered the derivation', () => {
    const profile = deriveAthleteProfile(all, athlete)
    const ride = makeRide({ moving_time: 3600, average_watts: 240 })

    // Same profile in, same load out — the invariant the dashboard now upholds
    // by deriving from the unfiltered list exactly once.
    const load = calculateTSS(ride, profile.thresholds)
    expect(load).toBeGreaterThan(0)
    expect(calculateTSS(ride, deriveAthleteProfile(all, athlete).thresholds)).toBe(load)
  })

  it('reports wattsPerKilo from the same FTP it reports', () => {
    const profile = deriveAthleteProfile(all, athlete)
    expect(profile.wattsPerKilo).toBeCloseTo(profile.ftp / athlete.weight, 6)
  })

  it('survives an empty history without throwing', () => {
    const profile = deriveAthleteProfile([], athlete)
    expect(profile.ftp).toBe(0)
    expect(profile.wattsPerKilo).toBe(0)
    expect(profile.ftpHistory).toEqual([])
  })
})

describe('deriveAthleteProfile — sport taxonomy', () => {
  it('counts a GravelRide toward FTP, not only toward the fitness curve', () => {
    const base = new Date('2026-08-01T00:00:00Z').toISOString()
    const gravel = [0, 1, 2].map((i) =>
      makeRide({
        id: 300 + i,
        type: 'Ride',
        sport_type: 'GravelRide',
        start_date: base,
        start_date_local: base.replace('Z', ''),
        average_watts: 280,
        moving_time: 3600,
      })
    )
    expect(deriveAthleteProfile(gravel, athlete).ftp).toBeGreaterThan(0)
  })
})
