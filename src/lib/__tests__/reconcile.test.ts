import { describe, it, expect } from 'vitest'
import type { StravaActivity } from '~/lib/strava'
import { INTERVALS_ID_OFFSET } from '~/lib/intervals'
import {
  dropDuplicates,
  findRedundantIntervalsCopies,
  knownActivities,
  reconcile,
} from '~/lib/sync/reconcile'

/** A Strava-era activity — plain numeric id below the intervals offset. */
function strava(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 19113368753,
    name: 'Løb om aftenen',
    type: 'Run',
    sport_type: 'Run',
    start_date: '2026-06-29T17:12:56Z',
    start_date_local: '2026-06-29T19:12:56Z',
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1550,
    total_elevation_gain: 30,
    average_speed: 3.3,
    max_speed: 4.1,
    ...overrides,
  }
}

/** An intervals.icu-era activity — id above the offset. */
function intervals(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return strava({
    id: INTERVALS_ID_OFFSET + 164403937,
    type: 'Ride',
    sport_type: 'Ride',
    start_date: '2026-07-09T09:15:02Z',
    start_date_local: '2026-07-09T11:15:02',
    ...overrides,
  })
}

describe('dropDuplicates', () => {
  it('drops a fetched activity matching an existing one by type and start time', () => {
    const existing = [strava()] // Run at 17:12:56Z
    const fetched = [intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })]
    expect(dropDuplicates(fetched, existing)).toHaveLength(0)
  })

  it('keeps activities with no time collision', () => {
    expect(dropDuplicates(
      [intervals({ type: 'Run', start_date: '2026-07-01T18:17:21Z' })],
      [strava()]
    )).toHaveLength(1)
  })

  it('keeps same-type activities outside the duplicate window', () => {
    // 17:20 is more than three minutes after 17:12:56.
    expect(dropDuplicates(
      [intervals({ type: 'Run', start_date: '2026-06-29T17:20:00Z' })],
      [strava()]
    )).toHaveLength(1)
  })

  it('always keeps a re-fetch of a known id so it upserts in place', () => {
    const known = intervals()
    expect(dropDuplicates([known], [known])).toHaveLength(1)
  })

  it('does not collide different types at the same time', () => {
    expect(dropDuplicates(
      [intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })],
      [strava({ type: 'Ride' })]
    )).toHaveLength(1)
  })

  it('drops a duplicate the two sources disagree about the type of', () => {
    // Old Zwift sessions cached from Strava as VirtualRide come back from
    // intervals.icu as plain Ride — a full sync used to insert both.
    expect(dropDuplicates(
      [intervals({ type: 'Ride', start_date: '2020-04-22T15:21:36Z' })],
      [strava({ type: 'VirtualRide', start_date: '2020-04-22T15:21:36Z' })]
    )).toHaveLength(0)
  })

  it('keeps a ride that only shares a start time with a run', () => {
    expect(dropDuplicates(
      [intervals({ type: 'VirtualRide', start_date: '2020-04-22T15:21:36Z' })],
      [strava({ type: 'Run', start_date: '2020-04-22T15:21:36Z' })]
    )).toHaveLength(1)
  })
})

describe('findRedundantIntervalsCopies', () => {
  it('flags intervals copies of Strava-era activities', () => {
    const stravaRun = strava()
    const copy = intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    const legit = intervals({ id: INTERVALS_ID_OFFSET + 999, type: 'Ride' })
    expect(findRedundantIntervalsCopies([stravaRun, copy, legit])).toEqual([copy.id])
  })

  it('returns empty when there is nothing to heal', () => {
    expect(findRedundantIntervalsCopies([strava(), intervals()])).toEqual([])
    expect(findRedundantIntervalsCopies([])).toEqual([])
  })

  it('never flags Strava-era activities themselves', () => {
    const a = strava({ id: 1 })
    const b = strava({ id: 2 }) // same time + type, both Strava-era
    expect(findRedundantIntervalsCopies([a, b])).toEqual([])
  })
})

describe('reconcile — merging a fetch', () => {
  it('adds activities the cache has never seen', () => {
    const cached = knownActivities([strava()])
    const fresh = intervals({ id: INTERVALS_ID_OFFSET + 1, type: 'Ride' })
    const result = reconcile(cached, [fresh])

    expect(result.added).toBe(1)
    expect(result.activities).toHaveLength(2)
    expect(result.toUpsert).toEqual([fresh])
  })

  it('does not count a re-fetch of a known activity as added', () => {
    const known = intervals()
    const result = reconcile(knownActivities([known]), [known])
    expect(result.added).toBe(0)
    expect(result.activities).toHaveLength(1)
  })

  it('does not duplicate an activity the other source already holds', () => {
    // The exact shape of the bug: the same run under two different ids.
    const cached = knownActivities([strava()])
    const sameRun = intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    const result = reconcile(cached, [sameRun])

    expect(result.added).toBe(0)
    expect(result.activities).toHaveLength(1)
    expect(result.activities[0].id).toBe(strava().id)
    expect(result.toUpsert).toEqual([])
  })

  it('preserves locally estimated power a re-fetch would wipe', () => {
    // Estimated watts are patched on locally for rides with no power meter;
    // intervals.icu doesn't carry them, so a re-fetch must not blank them.
    const enriched = intervals({ average_watts: 180 })
    const refetched = intervals({ average_watts: undefined })
    const result = reconcile(knownActivities([enriched]), [refetched])

    expect(result.activities[0].average_watts).toBe(180)
    expect(result.toUpsert[0].average_watts).toBe(180)
  })

  it('lets a real power value from the source win over the local estimate', () => {
    const estimated = intervals({ average_watts: 180 })
    const measured = intervals({ average_watts: 240 })
    const result = reconcile(knownActivities([estimated]), [measured])
    expect(result.activities[0].average_watts).toBe(240)
  })

  it('returns activities newest first', () => {
    const old = intervals({ id: INTERVALS_ID_OFFSET + 1, start_date: '2026-01-01T09:00:00Z' })
    const recent = intervals({ id: INTERVALS_ID_OFFSET + 2, start_date: '2026-08-01T09:00:00Z' })
    const result = reconcile(knownActivities([]), [old, recent])
    expect(result.activities.map((a) => a.id)).toEqual([recent.id, old.id])
  })
})

describe('reconcile — healing', () => {
  it('removes an intervals copy that duplicates a Strava-era activity', () => {
    const stravaRun = strava()
    const copy = intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    // Both already in the cache — the state a past bad sync left behind.
    const result = reconcile(knownActivities([stravaRun, copy]))

    expect(result.toDelete).toEqual([copy.id])
    expect(result.activities).toHaveLength(1)
    expect(result.activities[0].id).toBe(stravaRun.id)
  })

  it('is a no-op on a clean cache', () => {
    const result = reconcile(knownActivities([strava(), intervals()]))
    expect(result.toDelete).toEqual([])
    expect(result.added).toBe(0)
    expect(result.activities).toHaveLength(2)
  })

  it('never proposes deleting something it also proposes upserting', () => {
    const stravaRun = strava()
    const copy = intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    const result = reconcile(knownActivities([stravaRun, copy]), [copy])
    const upsertIds = new Set(result.toUpsert.map((a) => a.id))
    for (const id of result.toDelete) expect(upsertIds.has(id)).toBe(false)
  })

  it('is idempotent — reconciling the result again changes nothing', () => {
    const first = reconcile(knownActivities([
      strava(),
      intervals({ type: 'Run', start_date: '2026-06-29T17:12:56Z' }),
    ]))
    const second = reconcile(knownActivities(first.activities))

    expect(second.toDelete).toEqual([])
    expect(second.added).toBe(0)
    expect(second.activities).toEqual(first.activities)
  })
})

describe('reconcile — the empty-cache trap', () => {
  it('treats a genuinely empty cache as empty', () => {
    const fresh = intervals()
    const result = reconcile(knownActivities([]), [fresh])
    expect(result.added).toBe(1)
    expect(result.toUpsert).toEqual([fresh])
  })

  // A failed cache read used to be indistinguishable from an empty one: the
  // query returned [], every fetched activity looked new, and 33 activities
  // were duplicated. There is now no way to reach this function without an
  // explicit KnownActivities, which only a successful read produces — the
  // caller checks for null instead of remembering to check a boolean flag.
  it('cannot be called without an explicit complete view', () => {
    // @ts-expect-error a bare array is not a KnownActivities
    expect(() => reconcile([], [intervals()])).toThrow()
  })
})
