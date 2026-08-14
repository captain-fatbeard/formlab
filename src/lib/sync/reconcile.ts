import { type StravaActivity } from '../strava'
import { activityTypeFamily, isIntervalsActivityId } from '../intervals'

/** Two activities of the same type starting within this window are the same
 * workout recorded by two sources (Strava cache vs intervals.icu backfill). */
export const DUPLICATE_WINDOW_MS = 3 * 60 * 1000

declare const cacheBrand: unique symbol

/**
 * The complete set of activities the app knows about.
 *
 * Only constructible through `knownActivities`, which callers must reach for
 * with the result of a **successful** read. This is the whole point of the
 * type: reconciling against a partial view silently duplicates every activity
 * that already exists under another source's id, and that is exactly what
 * happened when a failed cached-activities query returned an empty array and
 * looked identical to an empty cache — 33 activities duplicated. A caller that
 * has no complete view now cannot produce one of these to pass in.
 */
export interface KnownActivities {
  readonly [cacheBrand]: true
  readonly all: readonly StravaActivity[]
}

/** Wrap the result of a successful read. Never call this on a failed one. */
export function knownActivities(activities: readonly StravaActivity[]): KnownActivities {
  return { all: activities } as KnownActivities
}

export interface Reconciliation {
  /** The merged set, newest first — what the app should now show. */
  activities: StravaActivity[]
  /** Rows to write back. Empty when the fetch added nothing new. */
  toUpsert: StravaActivity[]
  /** Ids to remove: intervals.icu copies of activities the Strava era already
   * holds. The Strava copy wins — it carries details and power estimates. */
  toDelete: number[]
  /** How many activities this reconciliation had never seen before. */
  added: number
}

function startTime(a: StravaActivity): number {
  return new Date(a.start_date).getTime()
}

/** Index of start times per type family, for the near-miss duplicate check. */
function startsByFamily(activities: readonly StravaActivity[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (const a of activities) {
    const family = activityTypeFamily(a.type)
    const starts = index.get(family)
    if (starts) starts.push(startTime(a))
    else index.set(family, [startTime(a)])
  }
  return index
}

/**
 * Drop fetched activities that are already present under a different id.
 *
 * The two sources don't always agree on an activity's type — indoor rides from
 * 2020 come back from intervals.icu as 'Ride' but were cached from Strava as
 * 'VirtualRide' — so types collapse into families first. Distinct enough that
 * a ride is never mistaken for a run, loose enough that a naming difference
 * between sources can't slip past.
 */
export function dropDuplicates(
  fetched: readonly StravaActivity[],
  existing: readonly StravaActivity[]
): StravaActivity[] {
  const existingIds = new Set(existing.map((a) => a.id))
  const index = startsByFamily(existing)

  return fetched.filter((a) => {
    if (existingIds.has(a.id)) return true // same id upserts in place
    const starts = index.get(activityTypeFamily(a.type))
    if (!starts) return true
    const start = startTime(a)
    return !starts.some((s) => Math.abs(s - start) < DUPLICATE_WINDOW_MS)
  })
}

/**
 * Intervals.icu-sourced activities that duplicate a Strava-era one. These can
 * exist from before the duplicate check covered type families, or from a sync
 * that ran against an incomplete view of the cache.
 */
export function findRedundantIntervalsCopies(
  activities: readonly StravaActivity[]
): number[] {
  const stravaEra = activities.filter((a) => !isIntervalsActivityId(a.id))
  const intervalsEra = activities.filter((a) => isIntervalsActivityId(a.id))
  if (stravaEra.length === 0 || intervalsEra.length === 0) return []

  const kept = new Set(dropDuplicates(intervalsEra, stravaEra).map((a) => a.id))
  return intervalsEra.filter((a) => !kept.has(a.id)).map((a) => a.id)
}

/**
 * Merge a fetch into what the app already knows, in one decision.
 *
 * Prevention (dropping duplicates before merge), healing (removing duplicates
 * that already exist) and the merge itself used to be three fragments across
 * two files, with the merge inline in a React component. The bug that recurred
 * was never in the arithmetic — it was in how the fragments were called, so
 * none of the pure-function tests could catch it.
 *
 * Pass an empty `fetched` to run a heal-only pass over the existing set.
 */
export function reconcile(
  known: KnownActivities,
  fetched: readonly StravaActivity[] = []
): Reconciliation {
  const existing = known.all
  const byId = new Map<number, StravaActivity>()
  for (const a of existing) byId.set(a.id, a)

  // Preserve locally-enriched fields — estimated power patched onto rides with
  // no power meter — that a re-fetched copy from intervals.icu won't carry.
  // Without this every sync wipes the estimates.
  const fresh = dropDuplicates(fetched, existing).map((a) => {
    const prev = byId.get(a.id)
    return prev?.average_watts && !a.average_watts
      ? { ...a, average_watts: prev.average_watts }
      : a
  })

  const added = fresh.filter((a) => !byId.has(a.id)).length
  for (const a of fresh) byId.set(a.id, a)

  const merged = Array.from(byId.values())
  const toDelete = findRedundantIntervalsCopies(merged)
  const removed = new Set(toDelete)

  return {
    activities: merged
      .filter((a) => !removed.has(a.id))
      .sort((a, b) => startTime(b) - startTime(a)),
    toUpsert: fresh.filter((a) => !removed.has(a.id)),
    toDelete,
    added,
  }
}
