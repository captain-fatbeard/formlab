import { createFileRoute, Outlet, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { storage } from '~/lib/storage'
import {
  DEFAULT_SETTINGS,
  type TimeRange,
  type ActivityType,
} from '~/lib/storage/supabase-client'
import { fetchIntervalsActivities, fetchIntervalsActivityDetails } from '~/lib/server-functions'
import { dedupeAgainstExisting, isIntervalsActivityId, findIntervalsDuplicateIds } from '~/lib/intervals'
import { type StravaActivity, type StravaAthlete, metersToKm } from '~/lib/strava'
import { calculateMaxHR, calculateRestingHR, calculateAge } from '~/lib/performance'
import { isRide, isRun } from '~/lib/tss'
import { deriveAthleteProfile, type AthleteProfile } from '~/lib/athlete-profile'
import {
  DashboardContext,
  type DashboardContextType,
  timeRangeToDays,
} from '~/lib/dashboard-context'
import {
  fetchWeightEntries,
  addWeightEntry as addWeightEntryToDb,
  deleteWeightEntry as deleteWeightEntryFromDb,
  fetchUserSettings,
  upsertUserSettings,
  fetchTrainingActivityIds,
  addTrainingActivity,
  removeTrainingActivity,
  fetchCachedActivities,
  upsertActivities,
  deleteActivities,
  cacheActivityDetails,
  fetchActivityIdsWithoutDetails,
  isSupabaseConfigured,
  type WeightEntry,
  type ActivityGroup,
  fetchActivityGroups,
  createActivityGroup,
  deleteActivityGroup,
  updateActivityGroupName,
} from '~/lib/storage/supabase-client'

export const Route = createFileRoute('/_dashboard')({
  component: DashboardLayout,
})

function mergeWithGroups(
  source: StravaActivity[],
  activityGroups: ActivityGroup[]
): StravaActivity[] {
  const groupedIds = new Set<number>()
  for (const group of activityGroups) {
    for (const id of group.activityIds) groupedIds.add(id)
  }

  const result: StravaActivity[] = source.filter((a) => !groupedIds.has(a.id))

  for (const group of activityGroups) {
    const members = group.activityIds
      .map((id) => source.find((a) => a.id === id))
      .filter((a): a is StravaActivity => a != null)

    if (members.length === 0) continue

    const wattsMembers = members.filter((a) => a.average_watts)
    const hrMembers = members.filter((a) => a.average_heartrate)

    const sorted = [...members].sort(
      (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
    )
    const typeCounts = new Map<string, number>()
    for (const m of members) typeCounts.set(m.type, (typeCounts.get(m.type) || 0) + 1)
    const predominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    const synthetic: StravaActivity = {
      id: -group.activityIds[0],
      name: group.name,
      type: predominantType,
      sport_type: sorted[0].sport_type,
      start_date: sorted[0].start_date,
      start_date_local: sorted[0].start_date_local,
      distance: members.reduce((s, a) => s + a.distance, 0),
      moving_time: members.reduce((s, a) => s + a.moving_time, 0),
      elapsed_time: members.reduce((s, a) => s + a.elapsed_time, 0),
      total_elevation_gain: members.reduce((s, a) => s + a.total_elevation_gain, 0),
      average_speed:
        members.reduce((s, a) => s + a.distance, 0) /
        members.reduce((s, a) => s + a.moving_time, 0),
      max_speed: Math.max(...members.map((a) => a.max_speed)),
      average_watts:
        wattsMembers.length > 0
          ? wattsMembers.reduce((s, a) => s + a.average_watts!, 0) / wattsMembers.length
          : undefined,
      max_watts: members.some((a) => a.max_watts)
        ? Math.max(...members.filter((a) => a.max_watts).map((a) => a.max_watts!))
        : undefined,
      weighted_average_watts:
        wattsMembers.length > 0 && wattsMembers.some((a) => a.weighted_average_watts)
          ? wattsMembers.filter((a) => a.weighted_average_watts).reduce((s, a) => s + a.weighted_average_watts!, 0) /
            wattsMembers.filter((a) => a.weighted_average_watts).length
          : undefined,
      average_heartrate:
        hrMembers.length > 0
          ? hrMembers.reduce((s, a) => s + a.average_heartrate!, 0) / hrMembers.length
          : undefined,
      max_heartrate: members.some((a) => a.max_heartrate)
        ? Math.max(...members.filter((a) => a.max_heartrate).map((a) => a.max_heartrate!))
        : undefined,
      average_cadence: members.some((a) => a.average_cadence)
        ? members.filter((a) => a.average_cadence).reduce((s, a) => s + a.average_cadence!, 0) /
          members.filter((a) => a.average_cadence).length
        : undefined,
      suffer_score: members.some((a) => a.suffer_score)
        ? members.reduce((s, a) => s + (a.suffer_score || 0), 0)
        : undefined,
      kilojoules: members.some((a) => a.kilojoules)
        ? members.reduce((s, a) => s + (a.kilojoules || 0), 0)
        : undefined,
    }

    result.push(synthetic)
  }

  return result.sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  )
}

// Totals for whatever slice of activities a page is showing. FTP and w/kg are
// athlete properties, not properties of the slice, so they come in from the
// profile rather than being re-estimated from the filtered set.
function computeStats(merged: StravaActivity[], profile: AthleteProfile) {
  const rides = merged.filter(isRide)
  const runs = merged.filter(isRun)

  const totalDistance = merged.reduce((sum, a) => sum + a.distance, 0)
  const totalElevation = merged.reduce((sum, a) => sum + a.total_elevation_gain, 0)
  const totalTime = merged.reduce((sum, a) => sum + a.moving_time, 0)

  const ridesWithWatts = rides.filter((a) => a.average_watts)
  const avgPower =
    ridesWithWatts.length > 0
      ? rides.reduce((sum, a) => sum + (a.average_watts || 0), 0) / ridesWithWatts.length
      : 0

  const withHR = merged.filter((a) => a.average_heartrate)
  const avgHR =
    withHR.length > 0
      ? merged.reduce((sum, a) => sum + (a.average_heartrate || 0), 0) / withHR.length
      : 0

  return {
    totalActivities: merged.length,
    totalDistance: metersToKm(totalDistance),
    totalElevation,
    totalTime,
    avgPower: Math.round(avgPower),
    avgHR: Math.round(avgHR),
    rides: rides.length,
    runs: runs.length,
    ftp: profile.ftp,
    wattsPerKilo: profile.wattsPerKilo,
  }
}

// How stale the activity list may get before returning to the tab triggers a
// re-sync. Short enough that a ride uploaded during the day shows up, long
// enough that flicking between tabs doesn't hammer the intervals.icu API.
const RESYNC_AFTER_MS = 10 * 60 * 1000

// The server rejects a passphrase that no longer matches APP_PASSPHRASE with
// this message. Worth separating from network failures: retrying never fixes
// it, and because a sync failure falls back to cached data, an unnoticed stale
// passphrase leaves the app quietly serving week-old activities forever.
function isStalePassphrase(err: unknown): boolean {
  return err instanceof Error && /invalid passphrase/i.test(err.message)
}

function DashboardLayout() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [athlete, setAthlete] = useState<StravaAthlete | null>(null)
  const [activities, setActivities] = useState<StravaActivity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null)
  const [syncMessage, setSyncMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_SETTINGS.timeRange)
  const [activityType, setActivityType] = useState<ActivityType>(DEFAULT_SETTINGS.activityType)
  const [birthday, setBirthday] = useState<string | null>(DEFAULT_SETTINGS.birthday)
  const [gender, setGender] = useState<'male' | 'female'>(DEFAULT_SETTINGS.gender)
  const [maxHROverride, setMaxHROverride] = useState<number | null>(DEFAULT_SETTINGS.maxHR)
  const [restingHROverride, setRestingHROverride] = useState<number | null>(DEFAULT_SETTINGS.restingHR)
  const [trainingActivityIds, setTrainingActivityIds] = useState<number[]>([])

  // Activity groups state
  const [activityGroups, setActivityGroups] = useState<ActivityGroup[]>([])

  // Weight tracking state
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([])


  // Derive weight from most recent weight entry
  const weight = useMemo(() => {
    if (weightEntries.length === 0) return 75 // Default weight
    return weightEntries[0].weight // Already sorted by recorded_at DESC
  }, [weightEntries])

  // Derive age from birthday
  const age = useMemo(() => calculateAge(birthday), [birthday])

  // Weight readable from async callbacks without stale closures
  const weightRef = useRef(weight)
  useEffect(() => {
    weightRef.current = weight
  }, [weight])

  // Auto-calculate Max HR and Resting HR from activity data
  const maxHRData = useMemo(() => calculateMaxHR(activities, age), [activities, age])
  const restingHRData = useMemo(() => calculateRestingHR(activities, age, gender), [activities, age, gender])
  // Use manual override if set, otherwise use calculated value
  const maxHR = maxHROverride ?? maxHRData.value
  const maxHRSource = maxHROverride ? 'manual' as const : maxHRData.source
  const restingHR = restingHROverride ?? restingHRData.value
  const restingHRSource = restingHROverride ? 'manual' as const : restingHRData.source

  // Track if settings have been loaded to avoid overwriting on mount
  const settingsLoaded = useRef(false)

  // Mirror of `activities` that sync callbacks can read without stale closures.
  // Kept in sync manually wherever activities are set from async flows.
  const activitiesRef = useRef<StravaActivity[]>([])

  // True only after the cached-activities query has SUCCEEDED (an empty cache
  // is fine; a failed query is not). Sync must never write results back while
  // this is false — deduplication against an incomplete view of the cache
  // permanently duplicates every activity that exists under a Strava id.
  const cacheHealthyRef = useRef(false)

  // When the last sync with intervals.icu completed. Used to throttle the
  // re-sync that runs whenever the tab becomes visible again.
  const lastSyncAtRef = useRef(0)
  const syncInFlightRef = useRef(false)

  const applyActivities = useCallback((merged: StravaActivity[]) => {
    activitiesRef.current = merged
    setActivities(merged)
  }, [])

  // Reusable sync callback. Cached activities (including the pre-intervals.icu
  // Strava history) are always preserved; fetched activities that duplicate an
  // existing one from the other source are dropped before merge and upsert.
  // Reports how many activities the sync added that the app had never seen
  // before, and whether they made it into Supabase — a merge that only lands in
  // React state looks identical to a real sync until the next page load.
  const syncActivities = useCallback(
    async (fetchAll: boolean): Promise<{ added: number; persisted: boolean }> => {
      // Two syncs racing would both dedupe against the same pre-merge snapshot
      // of `activitiesRef` and write conflicting merges back.
      if (syncInFlightRef.current) return { added: 0, persisted: true }
      syncInFlightRef.current = true

      try {
        const passphrase = await storage.auth.getPassphrase()
        const storedAthlete = await storage.auth.getAthlete()
        if (!passphrase || !storedAthlete) return { added: 0, persisted: true }

        const afterDate = fetchAll
          ? undefined
          : (() => {
              const cutoff = new Date()
              cutoff.setDate(cutoff.getDate() - 90)
              return cutoff.toISOString()
            })()

        const fetchedActivities = await fetchIntervalsActivities({
          data: { passphrase, afterDate },
        })

        const existing = activitiesRef.current
        const byId = new Map<number, StravaActivity>()
        for (const a of existing) byId.set(a.id, a)

        // Preserve locally-enriched fields (estimated power patched onto rides
        // without a power meter) that a re-fetched copy from intervals.icu
        // wouldn't carry — otherwise every sync wipes the estimates.
        const fresh = dedupeAgainstExisting(fetchedActivities, existing).map((a) => {
          const prev = byId.get(a.id)
          return prev?.average_watts && !a.average_watts
            ? { ...a, average_watts: prev.average_watts }
            : a
        })

        const addedCount = fresh.filter((a) => !byId.has(a.id)).length

        for (const a of fresh) byId.set(a.id, a)
        applyActivities(
          Array.from(byId.values()).sort(
            (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
          )
        )

        // Awaited: the detail backfill immediately queries Supabase for rows
        // without details_json, so these have to be committed before it runs.
        let persisted = true
        if (isSupabaseConfigured() && cacheHealthyRef.current && fresh.length > 0) {
          persisted = await upsertActivities(storedAthlete.id, fresh)
        }

        lastSyncAtRef.current = Date.now()
        return { added: addedCount, persisted }
      } finally {
        syncInFlightRef.current = false
      }
    },
    [applyActivities]
  )

  // Fetch and cache details for intervals.icu activities that don't have them
  // yet. Legacy Strava-era activities keep whatever details were cached before
  // the API access ended. Rides without a power meter get physics-estimated
  // watts patched onto their summary so scores, TSS and FTP inputs keep
  // working like they did with Strava's estimates.
  // Resolves to the number of activities it fetched details for.
  const backfillDetails = useCallback(
    async (athleteId: number, withProgress: boolean): Promise<number> => {
      if (!isSupabaseConfigured()) return 0

      const passphrase = await storage.auth.getPassphrase()
      if (!passphrase) return 0

      const uncachedIds = (await fetchActivityIdsWithoutDetails(athleteId)).filter(
        isIntervalsActivityId
      )
      if (uncachedIds.length === 0) return 0

      if (withProgress) setSyncProgress({ current: 0, total: uncachedIds.length })

      for (let i = 0; i < uncachedIds.length; i++) {
        if (withProgress) setSyncProgress({ current: i + 1, total: uncachedIds.length })

        try {
          const detailsJson = await fetchIntervalsActivityDetails({
            data: {
              passphrase,
              activityId: uncachedIds[i],
              riderWeight: weightRef.current,
            },
          })
          if (!detailsJson) continue

          cacheActivityDetails(uncachedIds[i], detailsJson)

          if (detailsJson.power_estimated && detailsJson.estimated_avg_watts) {
            const existing = activitiesRef.current.find((a) => a.id === uncachedIds[i])
            if (existing && !existing.average_watts) {
              const patched: StravaActivity = {
                ...existing,
                average_watts: detailsJson.estimated_avg_watts,
              }
              upsertActivities(athleteId, [patched])
              applyActivities(
                activitiesRef.current.map((a) => (a.id === patched.id ? patched : a))
              )
            }
          }
        } catch (err) {
          console.warn(`Failed to fetch details for activity ${uncachedIds[i]}:`, err)
        }

        // Small delay between requests (intervals.icu allows 2500 req / 15 min)
        if (i < uncachedIds.length - 1) {
          await new Promise((r) => setTimeout(r, 300))
        }
      }

      return uncachedIds.length
    },
    [applyActivities]
  )

  const handleSyncAll = useCallback(async () => {
    setIsSyncingAll(true)
    setSyncProgress(null)
    setSyncMessage(null)
    try {
      // Phase 1: Sync activity list
      const { added, persisted } = await syncActivities(true)

      // A merge that never reached Supabase looks like a successful sync until
      // the next page load throws it away, so say so rather than claiming ok.
      if (!persisted) {
        setSyncMessage({
          tone: 'error',
          text: `Fetched ${added} new ${added === 1 ? 'activity' : 'activities'} but could not save them. See the browser console.`,
        })
        return
      }

      const storedAthlete = await storage.auth.getAthlete()
      if (!storedAthlete) return

      // Phase 2: Fetch details for activities without cached details
      const detailed = await backfillDetails(storedAthlete.id, true)

      // A full sync usually has nothing to do, and finishing silently in a
      // second is indistinguishable from the button being broken. Always say
      // what happened.
      const parts = [
        added > 0 && `${added} new ${added === 1 ? 'activity' : 'activities'}`,
        detailed > 0 && `details for ${detailed} ${detailed === 1 ? 'ride' : 'rides'}`,
      ].filter(Boolean)

      setSyncMessage({
        tone: 'ok',
        text: parts.length > 0 ? `Synced ${parts.join(' · ')}.` : 'Already up to date.',
      })
    } catch (err) {
      console.error('Sync all failed:', err)
      if (isStalePassphrase(err)) {
        setSyncMessage({
          tone: 'error',
          text: 'Your saved passphrase is no longer valid. Log out and log in again.',
        })
      } else {
        const detail = err instanceof Error ? err.message : String(err)
        setSyncMessage({ tone: 'error', text: `Sync failed: ${detail}` })
      }
    } finally {
      setIsSyncingAll(false)
      setSyncProgress(null)
    }
  }, [syncActivities, backfillDetails])

  // Persist settings changes to database (only after initial load)
  useEffect(() => {
    if (!settingsLoaded.current || !athlete) return

    // Debounce to avoid rapid API calls during slider drags
    const timeoutId = setTimeout(() => {
      if (isSupabaseConfigured()) {
        upsertUserSettings(athlete.id, {
          birthday,
          gender,
          timeRange,
          activityType,
          maxHR: maxHROverride,
          restingHR: restingHROverride,
        })
      }
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [athlete, birthday, gender, timeRange, activityType, maxHROverride, restingHROverride])

  useEffect(() => {
    async function init() {
      // First check auth - we need athlete ID for settings
      const [passphrase, storedAthlete] = await Promise.all([
        storage.auth.getPassphrase(),
        storage.auth.getAthlete(),
      ])

      if (!passphrase || !storedAthlete) {
        navigate({ to: '/' })
        return
      }

      setAthlete(storedAthlete)

      // Load settings, training activity ids, and cached activities from Supabase
      let hasCachedData = false
      if (isSupabaseConfigured()) {
        const [settings, trainingIds, cachedActivities, groups] = await Promise.all([
          fetchUserSettings(storedAthlete.id),
          fetchTrainingActivityIds(storedAthlete.id),
          fetchCachedActivities(storedAthlete.id),
          fetchActivityGroups(storedAthlete.id),
        ])
        if (settings) {
          setTimeRange(settings.timeRange)
          setActivityType(settings.activityType)
          setBirthday(settings.birthday)
          setGender(settings.gender)
          setMaxHROverride(settings.maxHR)
          setRestingHROverride(settings.restingHR)
        }
        setTrainingActivityIds(trainingIds)
        setActivityGroups(groups)

        // null = query failed → cache state unknown, sync stays read-only
        if (cachedActivities !== null) {
          cacheHealthyRef.current = true

          // Self-heal: drop intervals.icu copies that duplicate a Strava-era
          // activity (can happen if a past sync ran against a failed cache
          // read) and delete them from Supabase.
          const duplicateIds = findIntervalsDuplicateIds(cachedActivities)
          const cleaned =
            duplicateIds.length > 0
              ? cachedActivities.filter((a) => !duplicateIds.includes(a.id))
              : cachedActivities
          if (duplicateIds.length > 0) {
            console.warn(`Removing ${duplicateIds.length} duplicate activities`)
            deleteActivities(storedAthlete.id, duplicateIds)
          }

          // If we have cached data, show it immediately
          if (cleaned.length > 0) {
            hasCachedData = true
            activitiesRef.current = cleaned
            setActivities(cleaned)
            setIsLoading(false)
          }
        }
      } else {
        // No Supabase at all — nothing to corrupt, sync freely
        cacheHealthyRef.current = true
      }
      settingsLoaded.current = true

      // Background sync with intervals.icu — a transient failure must never
      // clear auth, but a rejected passphrase has to surface (see below).
      try {
        await syncActivities(false)
        // Backfill details (and estimated power) for any new activities in the
        // background — the sync above has already committed them.
        backfillDetails(storedAthlete.id, false).catch((err) =>
          console.warn('Details backfill failed:', err)
        )
      } catch (err) {
        console.warn('intervals.icu sync failed, using cached data:', err)
        if (isStalePassphrase(err)) {
          await storage.auth.clear()
          setError('Your saved passphrase is no longer valid. Please log in again.')
        } else if (!hasCachedData) {
          setError('Failed to sync with intervals.icu. Please try again later.')
        }
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [navigate])

  // `init` runs once per page load, so an installed PWA or a tab left open for
  // days would keep showing the cache and never pick up new rides. Re-sync when
  // the app comes back to the foreground, throttled by RESYNC_AFTER_MS.
  useEffect(() => {
    if (!athlete) return

    const resync = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastSyncAtRef.current < RESYNC_AFTER_MS) return

      syncActivities(false)
        .then(() => backfillDetails(athlete.id, false))
        .catch(async (err) => {
          console.warn('Foreground re-sync failed:', err)
          if (isStalePassphrase(err)) {
            await storage.auth.clear()
            setError('Your saved passphrase is no longer valid. Please log in again.')
          }
        })
    }

    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)
    return () => {
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
    }
  }, [athlete, syncActivities, backfillDetails])

  const handleLogout = async () => {
    await storage.auth.clear()
    navigate({ to: '/' })
  }

  const toggleActivityCategory = useCallback(
    (activityId: number) => {
      if (!athlete) return

      const isCurrentlyTraining = trainingActivityIds.includes(activityId)

      // Optimistic update
      setTrainingActivityIds((prev) =>
        isCurrentlyTraining
          ? prev.filter((id) => id !== activityId)
          : [...prev, activityId]
      )

      // Persist to Supabase
      if (isSupabaseConfigured()) {
        if (isCurrentlyTraining) {
          removeTrainingActivity(athlete.id, activityId)
        } else {
          addTrainingActivity(athlete.id, activityId)
        }
      }
    },
    [athlete, trainingActivityIds]
  )

  // Load weight entries when athlete is available
  useEffect(() => {
    if (athlete && isSupabaseConfigured()) {
      fetchWeightEntries(athlete.id).then(setWeightEntries)
    }
  }, [athlete])

  const handleAddWeightEntry = useCallback(
    async (weightValue: number, recordedAt: Date): Promise<boolean> => {
      if (!athlete) return false
      const entry = await addWeightEntryToDb(athlete.id, weightValue, recordedAt)
      if (entry) {
        setWeightEntries((prev) =>
          [entry, ...prev].sort(
            (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
          )
        )
        return true
      }
      return false
    },
    [athlete]
  )

  const handleDeleteWeightEntry = useCallback(async (id: string): Promise<boolean> => {
    const success = await deleteWeightEntryFromDb(id)
    if (success) {
      setWeightEntries((prev) => prev.filter((e) => e.id !== id))
    }
    return success
  }, [])

  const handleCreateGroup = useCallback(
    async (name: string, activityIds: number[]): Promise<ActivityGroup | null> => {
      if (!athlete) return null
      const group = await createActivityGroup(athlete.id, name, activityIds)
      if (group) {
        setActivityGroups((prev) => [group, ...prev])
      }
      return group
    },
    [athlete]
  )

  const handleDeleteGroup = useCallback(async (groupId: string): Promise<boolean> => {
    const success = await deleteActivityGroup(groupId)
    if (success) {
      setActivityGroups((prev) => prev.filter((g) => g.id !== groupId))
    }
    return success
  }, [])

  const handleUpdateGroupName = useCallback(async (groupId: string, name: string): Promise<boolean> => {
    const success = await updateActivityGroupName(groupId, name)
    if (success) {
      setActivityGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, name } : g))
    }
    return success
  }, [])

  const activityTypeFiltered = useMemo(() => {
    if (activityType === 'all') return activities
    return activities.filter((a) => {
      if (activityType === 'Ride') return isRide(a)
      if (activityType === 'Run') return isRun(a)
      return a.type === activityType || a.sport_type === activityType
    })
  }, [activities, activityType])

  const filteredActivities = useMemo(() => {
    let filtered = activityTypeFiltered

    const now = new Date()
    let cutoff: Date

    switch (timeRange) {
      case '30d':
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case '6m':
        cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        break
      case '1y':
        cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        cutoff = new Date(0)
    }

    filtered = filtered.filter((a) => new Date(a.start_date) >= cutoff)

    return filtered.sort(
      (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
    )
  }, [activityTypeFiltered, timeRange])

  const mergedActivities = useMemo(
    () => mergeWithGroups(filteredActivities, activityGroups),
    [filteredActivities, activityGroups]
  )

  // Lifetime view: ignore time-range and activity-type filters so the overview
  // page can show all-time totals regardless of the global filter.
  const lifetimeMergedActivities = useMemo(
    () => mergeWithGroups(activities, activityGroups),
    [activities, activityGroups]
  )

  const statsActivities = useMemo(() => {
    return mergedActivities.filter((a) => !trainingActivityIds.includes(a.id))
  }, [mergedActivities, trainingActivityIds])

  // Activity-type-respecting set with no time-range cap — for charts that own their own
  // time selector so they can extend beyond the global range (e.g. Power Trend 1y / All).
  const lifetimeStatsActivities = useMemo(() => {
    const merged = mergeWithGroups(activityTypeFiltered, activityGroups)
    return merged
      .filter((a) => !trainingActivityIds.includes(a.id))
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
  }, [activityTypeFiltered, activityGroups, trainingActivityIds])

  // Derived from the complete history, never from a filtered view — the time
  // range and activity-type dropdowns must not be able to move FTP, and through
  // it every TSS, CTL and ATL in the app. See deriveAthleteProfile.
  const profile = useMemo(
    () => deriveAthleteProfile(lifetimeMergedActivities, { weight, maxHR, restingHR }),
    [lifetimeMergedActivities, weight, maxHR, restingHR]
  )

  const stats = useMemo(
    () => computeStats(mergedActivities, profile),
    [mergedActivities, profile]
  )

  const lifetimeStats = useMemo(
    () => computeStats(lifetimeMergedActivities, profile),
    [lifetimeMergedActivities, profile]
  )

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 text-center hero-gradient">
        <div className="size-10 border-2 border-border-subtle border-t-accent rounded-full animate-spin" />
        <p className="text-text-secondary text-sm font-light tracking-wide">Loading your data...</p>
      </div>
    )
  }

  if (error || !athlete) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 text-center hero-gradient">
        <p className="text-danger bg-danger-muted px-6 py-4 rounded-[var(--radius-md)] border border-red-500/20 text-sm">{error || 'Not authenticated'}</p>
        <Link to="/" className="bg-linear-to-br from-accent to-accent-dark text-white border border-accent/30 py-3 px-7 text-[0.875rem] font-semibold rounded-[var(--radius-md)] cursor-pointer no-underline transition-all duration-200 shadow-[0_4px_16px_rgba(20,184,166,0.25)] hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(20,184,166,0.35)]">Back to Login</Link>
      </div>
    )
  }

  const contextValue: DashboardContextType = {
    athlete,
    activities,
    filteredActivities,
    statsActivities,
    lifetimeStatsActivities,
    stats,
    lifetimeStats,
    lifetimeMergedActivities,
    timeRange,
    setTimeRange,
    activityType,
    setActivityType,
    weight,
    maxHR,
    maxHRSource,
    maxHRActivityCount: maxHRData.activityCount,
    restingHR,
    restingHRSource,
    restingHRActivityCount: restingHRData.activityCount,
    age,
    birthday,
    setBirthday,
    gender,
    setGender,
    timeRangeDays: timeRangeToDays[timeRange],
    trainingActivityIds,
    toggleActivityCategory,
    activityGroups,
    createGroup: handleCreateGroup,
    deleteGroup: handleDeleteGroup,
    updateGroupName: handleUpdateGroupName,
    weightEntries,
    addWeightEntry: handleAddWeightEntry,
    deleteWeightEntry: handleDeleteWeightEntry,
    tssThresholds: profile.thresholds,
    tssThresholdSources: profile.sources,
    profile,
  }

  const initials = `${athlete.firstname?.[0] || ''}${athlete.lastname?.[0] || ''}`

  return (
    <DashboardContext.Provider value={contextValue}>
      <div className="noise-bg relative">
        {/* ── Unified top bar ── */}
        <header className="top-bar">
          <div className="max-w-[1440px] mx-auto flex items-center h-14 px-6 gap-6 max-md:px-4 max-md:gap-3">
            {/* Logo */}
            <Link to="/overview" className="flex items-center gap-2.5 no-underline shrink-0 group">
              <svg className="shrink-0 transition-transform duration-300 group-hover:scale-105" width="26" height="26" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="url(#logo-gradient)"/>
                <path d="M8 22L12 14L16 18L20 10L24 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="14" r="2" fill="white"/>
                <circle cx="16" cy="18" r="2" fill="white"/>
                <circle cx="20" cy="10" r="2" fill="white"/>
                <defs>
                  <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
                    <stop stopColor="#14b8a6"/>
                    <stop offset="1" stopColor="#0891b2"/>
                  </linearGradient>
                </defs>
              </svg>
              <span className="text-lg font-semibold tracking-tight text-text-primary max-md:text-base">FormLab</span>
            </Link>

            {/* Divider */}
            <div className="w-px h-5 bg-border-subtle max-md:hidden" />

            {/* Desktop navigation */}
            <nav className="nav-links flex items-center gap-0.5 flex-1 max-md:hidden">
              <Link to="/plan" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Plan
              </Link>
              <Link to="/training" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                Training
              </Link>
              <Link to="/health" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                </svg>
                Health
              </Link>
              <Link to="/performance" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Performance
              </Link>
              <Link to="/records" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
                Records
              </Link>
              <Link to="/activities" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Activities
              </Link>
              <Link to="/bike-fit" activeProps={{ className: 'active' }} className="flex items-center gap-1.5 text-text-muted py-3.5 px-3 text-[0.8125rem] font-medium cursor-pointer relative transition-all duration-200 no-underline hover:text-text-secondary">
                <svg className="nav-icon size-[15px] transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="15" cy="5" r="1" /><path d="M12 17.5V14l-3-3 4-3 2 3h2" />
                </svg>
                Bike Fit
              </Link>
            </nav>

            {/* Right side: avatar + mobile hamburger */}
            <div className="flex items-center gap-2 ml-auto">
              {/* Avatar — opens settings */}
              <button
                className="size-8 rounded-full bg-accent/15 border border-accent/30 text-accent text-[0.6875rem] font-semibold flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/25 hover:border-accent/50 max-md:hidden"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={`${athlete.firstname} ${athlete.lastname}`}
              >
                {initials}
              </button>

              {/* Mobile hamburger */}
              <button
                className="hidden max-md:flex items-center justify-center text-text-muted size-8 rounded-[var(--radius-sm)] cursor-pointer transition-all duration-200 hover:bg-bg-tertiary hover:text-text-primary"
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                aria-label="Toggle navigation"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in" onClick={() => setMobileNavOpen(false)} />
        )}
        <aside className={`hidden max-md:flex flex-col fixed top-0 right-0 h-screen w-70 bg-bg-secondary border-l border-border z-50 shadow-lg transition-transform duration-300 max-[480px]:w-full ${mobileNavOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex justify-between items-center p-5 border-b border-border-subtle">
            <span className="text-base font-semibold text-text-primary">Menu</span>
            <button
              className="flex items-center justify-center text-text-muted size-8 rounded-[var(--radius-sm)] cursor-pointer transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div className="mobile-nav-links flex-1 flex flex-col gap-0.5 p-3 overflow-y-auto">
            <Link to="/plan" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Plan
            </Link>
            <Link to="/training" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              Training
            </Link>
            <Link to="/health" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
              Health
            </Link>
            <Link to="/performance" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              Performance
            </Link>
            <Link to="/records" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
              Records
            </Link>
            <Link to="/activities" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              Activities
            </Link>
            <Link to="/bike-fit" activeProps={{ className: 'active' }} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 relative hover:text-text-primary hover:bg-bg-tertiary">
              <svg className="nav-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="15" cy="5" r="1" /><path d="M12 17.5V14l-3-3 4-3 2 3h2" /></svg>
              Bike Fit
            </Link>
          </div>
          <div className="p-3 border-t border-border-subtle flex flex-col gap-1.5">
            <Link
              to="/docs"
              activeProps={{ className: 'active' }}
              onClick={() => setMobileNavOpen(false)}
              className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary no-underline text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              Docs
            </Link>
            <button
              className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary text-sm font-medium rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 w-full hover:bg-bg-tertiary hover:text-text-primary"
              onClick={() => { setMobileNavOpen(false); setSidebarOpen(true) }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Settings
            </button>
            <button onClick={() => { setMobileNavOpen(false); handleLogout() }} className="flex items-center gap-2.5 py-2.5 px-3 text-text-secondary text-sm font-medium rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 w-full hover:bg-bg-tertiary hover:text-text-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </aside>

        {/* Settings sidebar */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in" onClick={() => setSidebarOpen(false)} />
        )}
        <aside className={`fixed top-0 right-0 h-screen w-80 bg-bg-secondary border-l border-border z-50 flex flex-col shadow-lg transition-transform duration-300 max-md:w-full max-md:max-w-80 max-[480px]:max-w-none ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex justify-between items-center p-6 border-b border-border-subtle">
            <h2 className="text-xl font-semibold text-text-primary">Settings</h2>
            <button
              className="flex items-center justify-center bg-bg-tertiary border border-border text-text-secondary size-9 rounded-[var(--radius-sm)] cursor-pointer transition-all duration-150 hover:bg-bg-elevated hover:text-text-primary hover:border-text-muted"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-8">
              <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-4 pb-2 border-b border-border-subtle">Filters</h3>
              <div className="flex flex-col gap-2 mb-5">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">Time Range</label>
                <select
                  className="custom-select w-full bg-bg-tertiary border border-border text-text-primary py-2.5 pr-10 pl-4 rounded-[var(--radius-sm)] text-sm cursor-pointer transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                >
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="6m">Last 6 months</option>
                  <option value="1y">Last year</option>
                  <option value="all">All time</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">Activity Type</label>
                <select
                  className="custom-select w-full bg-bg-tertiary border border-border text-text-primary py-2.5 pr-10 pl-4 rounded-[var(--radius-sm)] text-sm cursor-pointer transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value as ActivityType)}
                >
                  <option value="all">All activities</option>
                  <option value="Ride">Cycling (incl. Zwift)</option>
                  <option value="Run">Running</option>
                  <option value="VirtualRide">Zwift only</option>
                </select>
              </div>
            </div>

            <div>
              <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-4 pb-2 border-b border-border-subtle">User Profile</h3>
              <div className="flex flex-col gap-2 mb-5">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">Max HR</label>
                <div className="flex items-center gap-2">
                  <input
                    className="w-20 bg-bg-tertiary border border-border text-text-primary py-2 px-3 rounded-[var(--radius-sm)] text-sm transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 data-value"
                    type="number"
                    min="100"
                    max="230"
                    placeholder={String(maxHRData.value)}
                    value={maxHROverride ?? ''}
                    onChange={(e) => setMaxHROverride(e.target.value ? Number(e.target.value) : null)}
                  />
                  <span className="text-sm text-text-secondary">bpm</span>
                </div>
                <span className="text-[0.65rem] text-text-muted">
                  {maxHROverride
                    ? 'manual override'
                    : maxHRData.source === 'observed'
                      ? `auto: ${maxHRData.value} bpm from ${maxHRData.activityCount} activities`
                      : `auto: ${maxHRData.value} bpm (Tanaka formula)`}
                </span>
              </div>

              <div className="flex flex-col gap-2 mb-5">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">Resting HR</label>
                <div className="flex items-center gap-2">
                  <input
                    className="w-20 bg-bg-tertiary border border-border text-text-primary py-2 px-3 rounded-[var(--radius-sm)] text-sm transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 data-value"
                    type="number"
                    min="30"
                    max="120"
                    placeholder={String(restingHRData.value)}
                    value={restingHROverride ?? ''}
                    onChange={(e) => setRestingHROverride(e.target.value ? Number(e.target.value) : null)}
                  />
                  <span className="text-sm text-text-secondary">bpm</span>
                </div>
                <span className="text-[0.65rem] text-text-muted">
                  {restingHROverride
                    ? 'manual override'
                    : restingHRData.source === 'observed'
                      ? `auto: ${restingHRData.value} bpm from ${restingHRData.activityCount} activities`
                      : `auto: ${restingHRData.value} bpm (age-based estimate)`}
                </span>
              </div>

              <div className="flex flex-col gap-2 mb-5">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">
                  Birthday{birthday ? ` (age ${age})` : ''}
                </label>
                <input
                  className="w-full bg-bg-tertiary border border-border text-text-primary py-2.5 px-4 rounded-[var(--radius-sm)] text-sm transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                  type="date"
                  value={birthday ?? ''}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setBirthday(e.target.value || null)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">Gender</label>
                <select
                  className="custom-select w-full bg-bg-tertiary border border-border text-text-primary py-2.5 pr-10 pl-4 rounded-[var(--radius-sm)] text-sm cursor-pointer transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'male' | 'female')}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-4 pb-2 border-b border-border-subtle">Data</h3>
              <button
                onClick={handleSyncAll}
                disabled={isSyncingAll}
                className="bg-bg-tertiary border border-border text-text-secondary py-2.5 px-4 rounded-[var(--radius-sm)] cursor-pointer text-sm font-medium transition-all duration-150 hover:bg-bg-elevated hover:text-text-primary hover:border-accent w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={isSyncingAll ? 'animate-spin' : ''}
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {isSyncingAll
                  ? syncProgress
                    ? `Processing ${syncProgress.current}/${syncProgress.total}...`
                    : 'Syncing activities...'
                  : 'Sync All Activities'}
              </button>
              {syncProgress && (
                <div className="mt-2">
                  <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[0.7rem] text-text-muted mt-1">
                    {syncProgress.current} of {syncProgress.total} rides — downloading splits, route and power data
                  </p>
                </div>
              )}
              {!syncProgress && syncMessage && (
                <p
                  className={`text-[0.7rem] mt-2 leading-relaxed ${
                    syncMessage.tone === 'error' ? 'text-red-400' : 'text-accent'
                  }`}
                >
                  {syncMessage.text}
                </p>
              )}
              {!syncProgress && !syncMessage && (
                <p className="text-[0.7rem] text-text-muted mt-2 leading-relaxed">
                  Fetches your full intervals.icu history and downloads detailed data (splits, route, power curves) for new activities.
                </p>
              )}
            </div>

            <div className="mt-8">
              <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-4 pb-2 border-b border-border-subtle">Reference</h3>
              <Link
                to="/docs"
                onClick={() => setSidebarOpen(false)}
                className="bg-bg-tertiary border border-border text-text-secondary py-2.5 px-4 rounded-[var(--radius-sm)] cursor-pointer text-sm font-medium transition-all duration-150 hover:bg-bg-elevated hover:text-text-primary hover:border-accent w-full flex items-center justify-center gap-2 no-underline"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
                Docs — how the data flows
              </Link>
              <p className="text-[0.7rem] text-text-muted mt-2 leading-relaxed">
                Sync pipeline, what&apos;s cached in Supabase, and what each page computes.
              </p>
            </div>
          </div>

          <div className="p-6 border-t border-border-subtle">
            <button onClick={handleLogout} className="bg-bg-tertiary border border-border text-text-secondary py-2.5 px-5 rounded-[var(--radius-sm)] cursor-pointer text-sm font-medium transition-all duration-150 hover:bg-bg-elevated hover:text-text-primary hover:border-text-muted w-full flex items-center justify-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="max-w-[1440px] mx-auto px-6 pt-8 pb-12 max-md:px-4 max-md:pt-6 max-[480px]:px-3">
          <Outlet />
        </main>
      </div>
    </DashboardContext.Provider>
  )
}
