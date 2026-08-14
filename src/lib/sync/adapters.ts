import { type ActivityDetailsJson, type StravaActivity } from '../strava'
import { fetchIntervalsActivities, fetchIntervalsActivityDetails } from '../server-functions'
import {
  cacheActivityDetails,
  deleteActivities,
  fetchActivityIdsWithoutDetails,
  fetchCachedActivities,
  isSupabaseConfigured,
  upsertActivities,
} from '../storage/supabase-client'
import { type ActivityCachePort, type ActivityFetchPort } from './activity-sync'

/** intervals.icu, through the app's server functions. */
export function intervalsFetchPort(passphrase: () => Promise<string | null>): ActivityFetchPort {
  return {
    async fetchActivities({ afterDate }) {
      const pass = await passphrase()
      if (!pass) return []
      return fetchIntervalsActivities({ data: { passphrase: pass, afterDate } })
    },
    async fetchDetails(activityId, riderWeight) {
      const pass = await passphrase()
      if (!pass) return null
      return fetchIntervalsActivityDetails({
        data: { passphrase: pass, activityId, riderWeight },
      })
    },
  }
}

/**
 * Supabase, when it's configured and the athlete is known.
 *
 * The athlete id is resolved per call rather than captured, so the engine can
 * be built before auth has resolved. With no id or no Supabase this behaves as
 * a null cache: reads *succeed* and return nothing, writes are no-ops. That is
 * deliberate — an accurate empty view, not an unknown one, so the engine stays
 * ready and an unconfigured install still syncs in memory.
 *
 * `load` passes through Supabase's null-on-failure, which is the distinction
 * the whole duplication bug turned on: a failed read is not an empty cache.
 */
export function appCachePort(athleteId: () => number | null): ActivityCachePort {
  const id = () => (isSupabaseConfigured() ? athleteId() : null)

  return {
    async load() {
      const a = id()
      return a === null ? [] : fetchCachedActivities(a)
    },
    async upsert(activities) {
      const a = id()
      return a === null ? true : upsertActivities(a, activities)
    },
    async remove(ids) {
      const a = id()
      if (a !== null) await deleteActivities(a, ids)
    },
    async saveDetails(activityId, details) {
      if (id() !== null) await cacheActivityDetails(activityId, details)
    },
    async idsWithoutDetails() {
      const a = id()
      return a === null ? [] : fetchActivityIdsWithoutDetails(a)
    },
  }
}

export type { ActivityDetailsJson, StravaActivity }
