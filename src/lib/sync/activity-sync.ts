import { type ActivityDetailsJson, type StravaActivity } from '../strava'
import { isIntervalsActivityId } from '../intervals'
import { knownActivities, reconcile, type KnownActivities } from './reconcile'

/** Where activities come from. */
export interface ActivityFetchPort {
  /** `afterDate` is an ISO string; omitted means the whole history. */
  fetchActivities(opts: { afterDate?: string }): Promise<StravaActivity[]>
  fetchDetails(activityId: number, riderWeight: number): Promise<ActivityDetailsJson | null>
}

/** Where activities are kept between sessions. */
export interface ActivityCachePort {
  /**
   * The cached set, or **null when the read failed** — which is not the same as
   * an empty cache and must not be treated as one. See reconcile().
   */
  load(): Promise<StravaActivity[] | null>
  upsert(activities: StravaActivity[]): Promise<boolean>
  remove(ids: number[]): Promise<void>
  saveDetails(activityId: number, details: ActivityDetailsJson): Promise<void>
  /** Ids of cached activities with no details stored yet. */
  idsWithoutDetails(): Promise<number[]>
}

export interface SyncResult {
  /** Activities this sync had never seen before. */
  added: number
  /**
   * Whether the merge reached the cache. A merge that only lands in memory
   * looks identical to a real sync until the next page load, so callers need
   * to be able to say so rather than reporting success.
   */
  persisted: boolean
  /** False when there was no complete view to reconcile against. */
  reconciled: boolean
}

export interface LoadResult {
  activities: StravaActivity[]
  /** Duplicate rows removed from the cache on the way in. */
  healed: number
  /** False when the cache read failed — the caller is running on nothing. */
  ok: boolean
}

export interface ActivitySyncOptions {
  fetch: ActivityFetchPort
  cache: ActivityCachePort
  /** Called whenever the activity set changes, to push it into the UI. */
  onActivities: (activities: StravaActivity[]) => void
  /** Read at call time so a weight change mid-session is picked up. */
  riderWeight: () => number
  clock?: () => number
  /** Pause between detail fetches — intervals.icu allows 2500 req / 15 min. */
  detailDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** How stale the activity list may get before returning to the tab re-syncs.
 * Short enough that a ride uploaded during the day shows up, long enough that
 * flicking between tabs doesn't hammer the intervals.icu API. */
export const RESYNC_AFTER_MS = 10 * 60 * 1000

const RECENT_WINDOW_DAYS = 90

/**
 * The ingestion engine: load, reconcile, persist, and backfill details.
 *
 * This used to live inline in DashboardLayout, where its invariants were four
 * refs and a set of prose comments, and where no test could reach it. Every
 * sync bug in this repo's history was in the orchestration rather than in the
 * arithmetic — a sync racing itself, a write racing a read, a cache read whose
 * failure looked like emptiness — so the orchestration is the part that needed
 * an interface.
 *
 * Holds the current activity set itself rather than reading it back out of
 * React, so callbacks can't see a stale closure.
 */
export function createActivitySync({
  fetch,
  cache,
  onActivities,
  riderWeight,
  clock = () => Date.now(),
  detailDelayMs = 300,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: ActivitySyncOptions) {
  /**
   * Set only once a cache read has succeeded. Null means there is no complete
   * view, and reconcile() cannot be called without one — that type is what
   * stops a sync deduplicating against a partial cache.
   */
  let known: KnownActivities | null = null
  let current: StravaActivity[] = []
  let lastSyncAt = 0
  let inFlight = false

  function publish(activities: StravaActivity[]) {
    current = activities
    known = knownActivities(activities)
    onActivities(activities)
  }

  function recentCutoff(): string {
    const cutoff = new Date(clock())
    cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS)
    return cutoff.toISOString()
  }

  return {
    /** What the engine currently holds. */
    activities: () => current as readonly StravaActivity[],

    /** True once a cache read has succeeded and a sync is safe to persist. */
    isReady: () => known !== null,

    /**
     * Read the cache and heal any duplicates in it. A failed read leaves the
     * engine unready, so a later sync stays read-only rather than reconciling
     * against a view it knows is incomplete.
     */
    async load(): Promise<LoadResult> {
      const cached = await cache.load()
      if (cached === null) return { activities: [], healed: 0, ok: false }

      const healed = reconcile(knownActivities(cached))
      publish(healed.activities)
      if (healed.toDelete.length > 0) await cache.remove(healed.toDelete)

      return { activities: healed.activities, healed: healed.toDelete.length, ok: true }
    },

    /** Treat an unconfigured cache as a complete and accurate empty view —
     * there's nothing to corrupt, so a sync is free to proceed. */
    startEmpty() {
      publish([])
    },

    /** Whether enough time has passed to be worth re-syncing. */
    isStale(): boolean {
      return clock() - lastSyncAt >= RESYNC_AFTER_MS
    },

    async sync({ full = false }: { full?: boolean } = {}): Promise<SyncResult> {
      // Two syncs racing would both reconcile against the same pre-merge
      // snapshot and write conflicting merges back.
      if (inFlight) return { added: 0, persisted: true, reconciled: false }
      inFlight = true

      try {
        const fetched = await fetch.fetchActivities({
          afterDate: full ? undefined : recentCutoff(),
        })

        // No complete view means nothing safe to reconcile against.
        if (!known) return { added: 0, persisted: false, reconciled: false }

        const result = reconcile(known, fetched)
        publish(result.activities)

        // Awaited: a detail backfill queries the cache for rows without
        // details, so these have to be committed before it runs.
        let persisted = true
        if (result.toUpsert.length > 0) persisted = await cache.upsert(result.toUpsert)
        if (result.toDelete.length > 0) await cache.remove(result.toDelete)

        lastSyncAt = clock()
        return { added: result.added, persisted, reconciled: true }
      } finally {
        inFlight = false
      }
    },

    /**
     * Fetch and store details for one activity, patching physics-estimated
     * watts onto the summary when the ride had no power meter — so scores, TSS
     * and FTP inputs keep working the way they did with Strava's estimates.
     *
     * The in-memory update is the point of having this in one place: the
     * activity detail page used to run its own copy of this pipeline, write the
     * estimate to the cache, and leave every derived number in the session
     * reading the un-patched activity until a reload.
     */
    async ensureDetails(activityId: number): Promise<ActivityDetailsJson | null> {
      if (!isIntervalsActivityId(activityId)) return null

      const details = await fetch.fetchDetails(activityId, riderWeight())
      if (!details) return null

      await cache.saveDetails(activityId, details)

      if (details.power_estimated && details.estimated_avg_watts) {
        const existing = current.find((a) => a.id === activityId)
        if (existing && !existing.average_watts) {
          const patched = { ...existing, average_watts: details.estimated_avg_watts }
          await cache.upsert([patched])
          publish(current.map((a) => (a.id === patched.id ? patched : a)))
        }
      }

      return details
    },

    /**
     * Fill in details for every cached activity missing them. Paced, and a
     * failure on one activity doesn't abandon the rest — a single bad activity
     * shouldn't cost you the whole backfill.
     *
     * Resolves to how many it fetched details for.
     */
    async backfillDetails(
      { onProgress }: { onProgress?: (current: number, total: number) => void } = {}
    ): Promise<number> {
      const pending = (await cache.idsWithoutDetails()).filter(isIntervalsActivityId)
      if (pending.length === 0) return 0

      onProgress?.(0, pending.length)

      for (let i = 0; i < pending.length; i++) {
        onProgress?.(i + 1, pending.length)
        try {
          await this.ensureDetails(pending[i])
        } catch (err) {
          console.warn(`Failed to fetch details for activity ${pending[i]}:`, err)
        }
        if (i < pending.length - 1 && detailDelayMs > 0) await sleep(detailDelayMs)
      }

      return pending.length
    },
  }
}

export type ActivitySync = ReturnType<typeof createActivitySync>
