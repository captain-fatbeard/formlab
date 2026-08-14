import { createContext, useContext } from 'react'
import { type StravaActivity, type StravaAthlete } from './strava'
import { type TimeRange, type ActivityType, type Gender } from './storage/supabase-client'
import type { WeightEntry, ActivityGroup } from './storage/supabase-client'
import type { TssThresholds, ThresholdSources } from './tss'
import type { AthleteProfile } from './athlete-profile'
import type { ActivitySync } from './sync/activity-sync'

export type { TimeRange, ActivityType, Gender }
export type { WeightEntry, ActivityGroup }

export const timeRangeToDays: Record<TimeRange, number> = {
  '30d': 30,
  '90d': 90,
  '6m': 180,
  '1y': 365,
  'all': 365 * 3,
}

export interface DashboardStats {
  totalActivities: number
  totalDistance: number
  totalElevation: number
  totalTime: number
  avgPower: number
  avgHR: number
  rides: number
  runs: number
  ftp: number
  wattsPerKilo: number
}

export interface DashboardContextType {
  athlete: StravaAthlete
  activities: StravaActivity[]
  filteredActivities: StravaActivity[]
  statsActivities: StravaActivity[]
  lifetimeStatsActivities: StravaActivity[]
  stats: DashboardStats
  lifetimeStats: DashboardStats
  lifetimeMergedActivities: StravaActivity[]
  timeRange: TimeRange
  setTimeRange: (range: TimeRange) => void
  activityType: ActivityType
  setActivityType: (type: ActivityType) => void
  weight: number
  maxHR: number
  maxHRSource: 'observed' | 'estimated' | 'manual'
  maxHRActivityCount: number
  restingHR: number
  restingHRSource: 'observed' | 'estimated' | 'manual'
  restingHRActivityCount: number
  age: number
  birthday: string | null
  setBirthday: (birthday: string | null) => void
  gender: Gender
  setGender: (gender: Gender) => void
  timeRangeDays: number
  trainingActivityIds: number[]
  toggleActivityCategory: (activityId: number) => void
  activityGroups: ActivityGroup[]
  createGroup: (name: string, activityIds: number[]) => Promise<ActivityGroup | null>
  deleteGroup: (groupId: string) => Promise<boolean>
  updateGroupName: (groupId: string, name: string) => Promise<boolean>
  weightEntries: WeightEntry[]
  addWeightEntry: (weight: number, recordedAt: Date) => Promise<boolean>
  deleteWeightEntry: (id: string) => Promise<boolean>
  tssThresholds: TssThresholds
  tssThresholdSources: ThresholdSources
  /** FTP, its history and the thresholds — derived from the complete history,
   * so it does not move when the time-range or type filter changes. */
  profile: AthleteProfile
  /** The ingestion engine. Pages that need details for one activity call
   * `sync.ensureDetails` rather than running their own fetch-and-cache, so a
   * patched power estimate reaches the live set and not just the database. */
  sync: ActivitySync
}

export const DashboardContext = createContext<DashboardContextType | null>(null)

export function useDashboard() {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboard must be used within DashboardLayout')
  }
  return context
}
