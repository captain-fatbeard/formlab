import { type StravaActivity } from '../strava'

export type SessionType =
  | 'z2' | 'rest' | 'opener' | 'test' | 'threshold'
  | 'vo2' | 'long' | 'tempo' | 'run' | 'tempo-run'

export interface PlanSession {
  type: SessionType
  label: string
  detail: string
  duration: string
  durationMinMin: number
  durationMaxMin: number
  /** acceptable power band as fraction of FTP — null if not power-constrained */
  powerFloor: number | null
  powerCeiling: number | null
  /** if true, finishing below powerFloor is acceptable (e.g. Z1 on a recovery day) */
  allowBelow: boolean
}

/** What the plan stores for a week. */
export type PlanPhase = 'recovery' | 'build' | 'paused'
export type PlanPhaseSetting = 'auto' | PlanPhase

/** What the planned lineup actually looks like, regardless of the stored phase. */
export type DerivedPhase = 'recovery' | 'build' | 'peak'

export type FitVerdict =
  | 'on-target' | 'below' | 'above' | 'over-duration' | 'under-duration'
  | 'rest-skipped' | 'pending' | 'none' | 'future' | 'paused'

export interface DayActual {
  movingTimeMin: number
  avgPower: number | null
  np: number | null
  avgHr: number | null
  distance: number
  activities: StravaActivity[]
}

export interface PlanDay {
  session: PlanSession
  date: Date
  actual: DayActual | null
  verdict: FitVerdict
  isToday: boolean
  isPastOrToday: boolean
}

export interface WeekStats {
  totalMinutes: number
  totalTSS: number
  sessions: number // non-rest days
  rest: number
  intensity: number
  easy: number
  easyMinutes: number
  intensityMinutes: number
}

export interface FitnessSnapshot {
  ctl: number
  atl: number
  tsb: number
}

export interface WeekSummary {
  weekStart: Date
  weekEnd: Date
  phase: PlanPhase
  days: PlanDay[]
  adherencePct: number
  sessionsLogged: number
  scoredCount: number
  startSnap: FitnessSnapshot | null
  endSnap: FitnessSnapshot | null
  totalTimeMin: number
  totalActivities: number
  actualTSS: number
}

export interface WeekShape {
  intensity: number
  easy: number
  rest: number
}
