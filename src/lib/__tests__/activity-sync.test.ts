import { describe, it, expect, vi } from 'vitest'
import type { ActivityDetailsJson, StravaActivity } from '~/lib/strava'
import { INTERVALS_ID_OFFSET } from '~/lib/intervals'
import {
  RESYNC_AFTER_MS,
  createActivitySync,
  type ActivityCachePort,
  type ActivityFetchPort,
} from '~/lib/sync/activity-sync'

function intervals(id: number, overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: INTERVALS_ID_OFFSET + id,
    name: `Ride ${id}`,
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

function strava(id: number, overrides: Partial<StravaActivity> = {}): StravaActivity {
  return intervals(0, { ...overrides, id })
}

/** An in-memory cache that records what it was asked to do. */
function fakeCache(seed: StravaActivity[] = [], opts: { failLoad?: boolean } = {}) {
  const state = {
    rows: [...seed],
    details: new Map<number, ActivityDetailsJson>(),
    upserts: [] as StravaActivity[][],
    removed: [] as number[],
    upsertOk: true,
  }
  const port: ActivityCachePort = {
    load: async () => (opts.failLoad ? null : state.rows),
    upsert: async (activities) => {
      state.upserts.push(activities)
      for (const a of activities) {
        const i = state.rows.findIndex((r) => r.id === a.id)
        if (i >= 0) state.rows[i] = a
        else state.rows.push(a)
      }
      return state.upsertOk
    },
    remove: async (ids) => {
      state.removed.push(...ids)
      state.rows = state.rows.filter((r) => !ids.includes(r.id))
    },
    saveDetails: async (id, d) => {
      state.details.set(id, d)
    },
    idsWithoutDetails: async () => state.rows.filter((r) => !state.details.has(r.id)).map((r) => r.id),
  }
  return { port, state }
}

function fakeFetch(activities: StravaActivity[] = [], details: ActivityDetailsJson | null = null) {
  const calls = { activities: [] as Array<{ afterDate?: string }>, details: [] as number[] }
  const port: ActivityFetchPort = {
    fetchActivities: async (o) => {
      calls.activities.push(o)
      return activities
    },
    fetchDetails: async (id) => {
      calls.details.push(id)
      return details
    },
  }
  return { port, calls }
}

/** Engine wired to fakes, with the pacing delay removed. */
function makeSync(over: Partial<Parameters<typeof createActivitySync>[0]> = {}) {
  const published: StravaActivity[][] = []
  const sync = createActivitySync({
    fetch: fakeFetch().port,
    cache: fakeCache().port,
    onActivities: (a) => published.push(a),
    riderWeight: () => 75,
    detailDelayMs: 0,
    ...over,
  })
  return { sync, published }
}

describe('load', () => {
  it('publishes the cached set', async () => {
    const cache = fakeCache([intervals(1), intervals(2, { start_date: '2026-08-02T08:00:00Z' })])
    const { sync, published } = makeSync({ cache: cache.port })

    const result = await sync.load()
    expect(result.ok).toBe(true)
    expect(result.activities).toHaveLength(2)
    expect(published.at(-1)).toHaveLength(2)
    expect(sync.isReady()).toBe(true)
  })

  it('heals duplicates in the cache and deletes them', async () => {
    // A Strava-era run and an intervals copy of the same workout.
    const stravaRun = strava(19113368753, { type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    const copy = intervals(5, { type: 'Run', start_date: '2026-06-29T17:12:56Z' })
    const cache = fakeCache([stravaRun, copy])
    const { sync } = makeSync({ cache: cache.port })

    const result = await sync.load()
    expect(result.healed).toBe(1)
    expect(result.activities).toHaveLength(1)
    expect(cache.state.removed).toEqual([copy.id])
  })

  it('stays unready when the cache read fails', async () => {
    const cache = fakeCache([], { failLoad: true })
    const { sync } = makeSync({ cache: cache.port })

    const result = await sync.load()
    expect(result.ok).toBe(false)
    expect(sync.isReady()).toBe(false)
  })
})

describe('sync — the guard that a failed cache read imposes', () => {
  // This is the shape of the duplication bug: a failed read must not let a
  // sync run, or every fetched activity looks new and gets inserted again.
  it('refuses to reconcile before a successful load', async () => {
    const fetch = fakeFetch([intervals(1), intervals(2)])
    const cache = fakeCache([], { failLoad: true })
    const { sync, published } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    const result = await sync.sync()

    expect(result.reconciled).toBe(false)
    expect(result.persisted).toBe(false)
    expect(result.added).toBe(0)
    expect(cache.state.upserts).toEqual([])
    expect(published).toEqual([]) // nothing was pushed to the UI either
  })

  it('runs once the cache is known to be empty', async () => {
    const fetch = fakeFetch([intervals(1)])
    const cache = fakeCache([])
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    const result = await sync.sync()

    expect(result.reconciled).toBe(true)
    expect(result.added).toBe(1)
  })

  it('startEmpty makes an unconfigured cache a usable empty view', async () => {
    const fetch = fakeFetch([intervals(1)])
    const { sync } = makeSync({ fetch: fetch.port })
    sync.startEmpty()
    expect(sync.isReady()).toBe(true)
    expect((await sync.sync()).added).toBe(1)
  })
})

describe('sync — merging and persistence', () => {
  it('adds new activities and upserts only those', async () => {
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([intervals(1), intervals(2, { start_date: '2026-08-05T08:00:00Z' })])
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    const result = await sync.sync()

    expect(result.added).toBe(1)
    expect(result.persisted).toBe(true)
    expect(cache.state.upserts).toHaveLength(1)
  })

  it('reports persisted:false when the write fails', async () => {
    // A merge that only lands in memory looks like a successful sync until the
    // next page load throws it away.
    const cache = fakeCache([])
    cache.state.upsertOk = false
    const fetch = fakeFetch([intervals(1)])
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    expect((await sync.sync()).persisted).toBe(false)
  })

  it('counts a re-fetch as nothing new, but still refreshes the row', async () => {
    // A known id upserts in place rather than being dropped, so a changed
    // field upstream still lands — it just isn't an addition.
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([intervals(1, { name: 'Renamed' })])
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    const result = await sync.sync()

    expect(result.added).toBe(0)
    expect(cache.state.rows[0].name).toBe('Renamed')
  })

  it('writes nothing when the fetch comes back empty', async () => {
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([])
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })

    await sync.load()
    const result = await sync.sync()
    expect(result.added).toBe(0)
    expect(cache.state.upserts).toEqual([])
  })

  it('fetches only the recent window unless asked for everything', async () => {
    const fetch = fakeFetch([])
    const { sync } = makeSync({ fetch: fetch.port })
    sync.startEmpty()

    await sync.sync()
    expect(fetch.calls.activities[0].afterDate).toBeDefined()

    await sync.sync({ full: true })
    expect(fetch.calls.activities[1].afterDate).toBeUndefined()
  })
})

describe('sync — the race guard', () => {
  it('drops a second sync that starts while one is in flight', async () => {
    let release: (v: StravaActivity[]) => void
    const gate = new Promise<StravaActivity[]>((r) => { release = r })
    const fetch: ActivityFetchPort = {
      fetchActivities: () => gate,
      fetchDetails: async () => null,
    }
    const { sync } = makeSync({ fetch })
    sync.startEmpty()

    const first = sync.sync()
    const second = await sync.sync() // returns immediately, does nothing

    expect(second.reconciled).toBe(false)
    release!([intervals(1)])
    expect((await first).added).toBe(1)
  })

  it('clears the guard even when the fetch throws', async () => {
    const fetch: ActivityFetchPort = {
      fetchActivities: async () => { throw new Error('network') },
      fetchDetails: async () => null,
    }
    const { sync } = makeSync({ fetch })
    sync.startEmpty()

    await expect(sync.sync()).rejects.toThrow('network')
    // A failed sync must not wedge the engine shut.
    const after = makeSync()
    expect(after.sync).toBeDefined()
    await expect(sync.sync()).rejects.toThrow('network')
  })
})

describe('sync — staleness throttle', () => {
  it('is stale before any sync has run', () => {
    const { sync } = makeSync({ clock: () => 1_000_000 })
    expect(sync.isStale()).toBe(true)
  })

  it('is not stale immediately after a sync, and is again later', async () => {
    let now = 1_000_000
    const { sync } = makeSync({ clock: () => now })
    sync.startEmpty()

    await sync.sync()
    expect(sync.isStale()).toBe(false)

    now += RESYNC_AFTER_MS - 1
    expect(sync.isStale()).toBe(false)

    now += 1
    expect(sync.isStale()).toBe(true)
  })
})

describe('ensureDetails', () => {
  const withEstimate: ActivityDetailsJson = {
    power_estimated: true,
    estimated_avg_watts: 180,
  } as ActivityDetailsJson

  it('ignores Strava-era activities, whose details can no longer be fetched', async () => {
    const fetch = fakeFetch([], withEstimate)
    const { sync } = makeSync({ fetch: fetch.port })
    expect(await sync.ensureDetails(19113368753)).toBeNull()
    expect(fetch.calls.details).toEqual([])
  })

  it('caches the details it fetched', async () => {
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([], withEstimate)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    await sync.ensureDetails(INTERVALS_ID_OFFSET + 1)
    expect(cache.state.details.has(INTERVALS_ID_OFFSET + 1)).toBe(true)
  })

  // The bug this consolidation fixes: the detail page wrote the estimate to the
  // cache but left every derived number in the session reading the old value.
  it('patches estimated watts into the live set, not only the cache', async () => {
    const cache = fakeCache([intervals(1, { average_watts: undefined })])
    const fetch = fakeFetch([], withEstimate)
    const { sync, published } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    await sync.ensureDetails(INTERVALS_ID_OFFSET + 1)

    expect(sync.activities()[0].average_watts).toBe(180)
    expect(published.at(-1)![0].average_watts).toBe(180)
    expect(cache.state.rows[0].average_watts).toBe(180)
  })

  it('never overwrites real measured power with an estimate', async () => {
    const cache = fakeCache([intervals(1, { average_watts: 240 })])
    const fetch = fakeFetch([], withEstimate)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    await sync.ensureDetails(INTERVALS_ID_OFFSET + 1)
    expect(sync.activities()[0].average_watts).toBe(240)
  })

  it('leaves the set alone when the details carry no estimate', async () => {
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const { sync, published } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()
    const before = published.length

    await sync.ensureDetails(INTERVALS_ID_OFFSET + 1)
    expect(published.length).toBe(before)
  })
})

describe('backfillDetails', () => {
  it('fetches details for every activity missing them', async () => {
    const cache = fakeCache([intervals(1), intervals(2), intervals(3)])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    expect(await sync.backfillDetails()).toBe(3)
    expect(fetch.calls.details).toHaveLength(3)
  })

  it('skips Strava-era ids it cannot fetch', async () => {
    // Different days, so load() doesn't heal one as a duplicate of the other.
    const cache = fakeCache([
      strava(19113368753, { start_date: '2026-07-01T08:00:00Z' }),
      intervals(2),
    ])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    expect(await sync.backfillDetails()).toBe(1)
  })

  it('carries on after one activity fails', async () => {
    // A single bad activity shouldn't cost the whole backfill.
    const cache = fakeCache([intervals(1), intervals(2), intervals(3)])
    let call = 0
    const fetch: ActivityFetchPort = {
      fetchActivities: async () => [],
      fetchDetails: async () => {
        call++
        if (call === 2) throw new Error('boom')
        return { power_estimated: false } as ActivityDetailsJson
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync } = makeSync({ fetch, cache: cache.port })
    await sync.load()

    expect(await sync.backfillDetails()).toBe(3)
    expect(call).toBe(3)
    warn.mockRestore()
  })

  it('reports progress across the run', async () => {
    const cache = fakeCache([intervals(1), intervals(2)])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    const seen: Array<[number, number]> = []
    await sync.backfillDetails({ onProgress: (c, t) => seen.push([c, t]) })
    expect(seen).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('does nothing when every activity already has details', async () => {
    const cache = fakeCache([intervals(1)])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const { sync } = makeSync({ fetch: fetch.port, cache: cache.port })
    await sync.load()

    await sync.backfillDetails()
    expect(await sync.backfillDetails()).toBe(0)
  })

  it('paces its requests', async () => {
    const cache = fakeCache([intervals(1), intervals(2), intervals(3)])
    const fetch = fakeFetch([], { power_estimated: false } as ActivityDetailsJson)
    const slept: number[] = []
    const { sync } = makeSync({
      fetch: fetch.port,
      cache: cache.port,
      detailDelayMs: 300,
      sleep: async (ms) => { slept.push(ms) },
    })
    await sync.load()

    await sync.backfillDetails()
    // One pause between each pair, none after the last.
    expect(slept).toEqual([300, 300])
  })
})
