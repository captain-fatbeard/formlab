import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  format,
  addDays,
  startOfWeek,
  isSameDay,
  isToday,
  subDays,
  differenceInDays,
  parseISO,
} from 'date-fns'
import { da } from 'date-fns/locale'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { useDashboard } from '~/lib/dashboard-context'
import { calculateFitnessOverTime, estimateFTPHistory } from '~/lib/performance'
import { calculateTSS, type TssThresholds } from '~/lib/tss'
import { rollup } from '~/lib/rollup'
import { chartTheme, tooltipStyle } from '~/lib/chart-theme'
import { type StravaActivity } from '~/lib/strava'
import {
  deletePlanDayOverride,
  fetchPlanDayOverrides,
  fetchPlanWeekPhases,
  isSupabaseConfigured,
  upsertPlanDayOverride,
  upsertPlanWeekPhase,
} from '~/lib/storage/supabase-client'

export const Route = createFileRoute('/_dashboard/plan')({
  component: PlanPage,
})

type SessionType = 'z2' | 'rest' | 'opener' | 'test' | 'threshold' | 'vo2' | 'long' | 'tempo' | 'run' | 'tempo-run'

interface PlanSession {
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

// Default session definition for each type, used when a day is overridden
// to a different type than the template's default.
const SESSION_CATALOG: Record<SessionType, PlanSession> = {
  z2: { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 100, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  rest: { type: 'rest', label: 'Rest', detail: 'Full off day', duration: '—', durationMinMin: 0, durationMaxMin: 30, powerFloor: null, powerCeiling: null, allowBelow: true },
  opener: { type: 'opener', label: 'Opener', detail: 'Z2 with 3×1 min short openers', duration: '45 min', durationMinMin: 30, durationMaxMin: 60, powerFloor: 0.55, powerCeiling: 1.05, allowBelow: true },
  test: { type: 'test', label: 'Test ride', detail: 'Climb portal or structured effort', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 120, powerFloor: null, powerCeiling: null, allowBelow: true },
  threshold: { type: 'threshold', label: 'Threshold', detail: '2×20 min at FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.7, powerCeiling: 1.05, allowBelow: false },
  vo2: { type: 'vo2', label: 'VO2max', detail: '5×4 min at 110–115% FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.65, powerCeiling: 1.1, allowBelow: false },
  long: { type: 'long', label: 'Long Z2', detail: 'Aerobic volume, flat or rolling', duration: '90–120 min', durationMinMin: 75, durationMaxMin: 150, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  tempo: { type: 'tempo', label: 'Tempo ride', detail: 'Steady upper-Z2 / Z3 — hilly Zwift routes, sustained climbs', duration: '90–180 min', durationMinMin: 60, durationMaxMin: 200, powerFloor: 0.7, powerCeiling: 0.92, allowBelow: false },
  run: { type: 'run', label: 'Easy run', detail: 'Truly easy, conversational pace', duration: '30 min', durationMinMin: 20, durationMaxMin: 40, powerFloor: null, powerCeiling: null, allowBelow: true },
  'tempo-run': { type: 'tempo-run', label: 'Tempo run', detail: 'Comfortably hard to hard — 80–85% max HR / Z3–Z4', duration: '30–40 min', durationMinMin: 25, durationMaxMin: 45, powerFloor: null, powerCeiling: null, allowBelow: false },
}

// Type categories used for the "weekly shape" check after day overrides.
const INTENSITY_TYPES: SessionType[] = ['threshold', 'vo2', 'tempo', 'tempo-run']
const EASY_TYPES: SessionType[] = ['z2', 'long', 'run']

// Expected weekly counts per phase, derived from the default RECOVERY_PLAN
// and BUILD_PLAN. The "shape" banner warns if the customized week drifts
// far from these.
const PHASE_WEEK_TARGETS: Record<PlanPhase, { intensity: number; easy: number; rest: number }> = {
  recovery: { intensity: 0, easy: 4, rest: 1 },
  build: { intensity: 2, easy: 3, rest: 2 },
  paused: { intensity: 0, easy: 0, rest: 7 },
}

function countWeekShape(template: PlanSession[]): { intensity: number; easy: number; rest: number } {
  let intensity = 0
  let easy = 0
  let rest = 0
  for (const s of template) {
    if (INTENSITY_TYPES.includes(s.type)) intensity++
    else if (EASY_TYPES.includes(s.type)) easy++
    else if (s.type === 'rest') rest++
  }
  return { intensity, easy, rest }
}

// Derived phase classification. Drives the displayed label/colors based on
// the actual planned lineup, regardless of which template was originally
// loaded. Still binary at the storage layer — this is purely cosmetic.
type DerivedPhase = 'recovery' | 'build' | 'peak'

const DERIVED_PHASE_META: Record<DerivedPhase, { title: string; tone: string; description: string }> = {
  recovery: {
    title: 'Recovery Week',
    tone: 'text-teal-300 bg-teal-500/10 border-teal-500/30',
    description: 'No intensity sessions — fatigue bleeds off, fitness held with aerobic work',
  },
  build: {
    title: 'Build Week',
    tone: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
    description: 'Mix of intensity + endurance — fitness climbs while form stays neutral',
  },
  peak: {
    title: 'Peak Week',
    tone: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
    description: '3+ intensity days — sharpening fitness, form drops short-term',
  },
}

const PAUSED_WEEK_META = {
  title: 'Paused',
  tone: 'text-neutral-300 bg-neutral-500/10 border-neutral-500/30',
  description: 'Plan on hold — no sessions scheduled, nothing counts as missed. Rides still record TSS and fitness.',
}

// Hard-intensity types (threshold/VO2) drive Peak classification. Tempo-run is
// counted as "non-easy" for polarization and shape, but doesn't on its own bump
// a week to Peak — three tempo runs is still a Build week, three threshold/VO2
// days is a Peak week.
const HARD_INTENSITY_TYPES: SessionType[] = ['threshold', 'vo2']

function classifyDerivedPhase(template: PlanSession[]): DerivedPhase {
  const hardCount = template.filter((s) => HARD_INTENSITY_TYPES.includes(s.type)).length
  if (hardCount >= 3) return 'peak'
  if (hardCount >= 1) return 'build'
  return 'recovery'
}

// Estimated training stress per minute by session type. Coarse — uses
// single-IF approximations rather than per-interval modeling. Good enough
// to get a weekly TSS ballpark in the Stats panel.
// Calibrated 2026-05-02 against the user's actual upper-Z2 / IF~0.88 threshold
// pattern — see TSS analysis in conversation history. Old values were keyed
// to band-floor IFs and consistently undershot real accumulation by 30–55%.
const TSS_PER_MIN: Record<SessionType, number> = {
  rest: 0,
  z2: 0.75,
  long: 0.7,
  opener: 0.7,
  run: 0.7,
  test: 1.0,
  tempo: 1.05,
  threshold: 1.2,
  vo2: 1.3,
  'tempo-run': 1.4,
}

function plannedSessionTSS(s: PlanSession): number {
  const minutes = (s.durationMinMin + s.durationMaxMin) / 2
  return Math.round(minutes * TSS_PER_MIN[s.type])
}

function plannedSessionMinutes(s: PlanSession): number {
  return (s.durationMinMin + s.durationMaxMin) / 2
}

interface WeekStats {
  totalMinutes: number
  totalTSS: number
  sessions: number // non-rest days
  rest: number
  intensity: number
  easy: number
  easyMinutes: number
  intensityMinutes: number
}

// Healthy weekly intensity/rest ranges per derived phase. TSS targets are
// computed dynamically from the rider's current CTL — see buildPlanRecommendations.
const PHASE_TARGETS: Record<DerivedPhase, {
  intensityMin: number
  intensityMax: number
  restMin: number
  intensityPctMax: number // share of riding time that should be hard
}> = {
  recovery: { intensityMin: 0, intensityMax: 0, restMin: 1, intensityPctMax: 5 },
  build: { intensityMin: 1, intensityMax: 2, restMin: 1, intensityPctMax: 25 },
  peak: { intensityMin: 2, intensityMax: 3, restMin: 1, intensityPctMax: 30 },
}

// TSS bands as multiples of weekly maintenance (CTL × 7). Recovery sits below
// maintenance (so CTL drops), build is around maintenance, peak slightly above.
const PHASE_TSS_FACTORS: Record<DerivedPhase, { min: number; max: number }> = {
  recovery: { min: 0.6, max: 0.85 },
  build: { min: 0.95, max: 1.25 },
  peak: { min: 1.15, max: 1.55 },
}

// Absolute fallback ranges when no CTL data is available (new account etc).
const PHASE_TSS_FALLBACK: Record<DerivedPhase, { min: number; max: number }> = {
  recovery: { min: 150, max: 320 },
  build: { min: 300, max: 500 },
  peak: { min: 450, max: 700 },
}

function buildPlanRecommendations(
  stats: WeekStats,
  phase: DerivedPhase,
  ctl: number | null,
): string[] {
  const recs: string[] = []
  const t = PHASE_TARGETS[phase]
  const totalNonRest = stats.easyMinutes + stats.intensityMinutes
  const intensityPct = totalNonRest > 0 ? (stats.intensityMinutes / totalNonRest) * 100 : 0

  // Personalize TSS bounds against the rider's current CTL when available.
  const maintenance = ctl ? Math.round(ctl * 7) : null
  const factors = PHASE_TSS_FACTORS[phase]
  const fallback = PHASE_TSS_FALLBACK[phase]
  const tssMin = maintenance ? Math.round(maintenance * factors.min) : fallback.min
  const tssMax = maintenance ? Math.round(maintenance * factors.max) : fallback.max
  const ctlNote = maintenance ? ` (maintenance ≈ ${maintenance} at CTL ${ctl})` : ''

  const tssLow = stats.totalTSS < tssMin
  const tssHigh = stats.totalTSS > tssMax
  const intensityHigh = stats.intensity > t.intensityMax
  const intensityLow = stats.intensity < t.intensityMin
  const polarizationOff = intensityPct > t.intensityPctMax && stats.intensity > 0

  // Combined situations first — say it as one coherent fix instead of three
  // overlapping nags pointing at the same problem.
  if (intensityHigh && tssLow) {
    recs.push(
      `${stats.intensity} hard days but only ${stats.totalTSS} TSS — heavy on intensity, light on volume. Swap one threshold/VO2 for a long Z2: drops you to a polarized 80/20 mix and lifts weekly TSS toward target ${tssMin}–${tssMax}${ctlNote} in one move.`,
    )
  } else if (intensityHigh && polarizationOff) {
    recs.push(
      `${stats.intensity} hard days = ${Math.round(intensityPct)}% of riding time at intensity (above the ~80/20 norm). Swap one threshold/VO2 for endurance.`,
    )
  } else if (intensityHigh) {
    recs.push(
      `${stats.intensity} intensity days is heavy for a ${phase} week (typical ${t.intensityMin}${t.intensityMax > t.intensityMin ? `–${t.intensityMax}` : ''}). Swap one for endurance to protect recovery.`,
    )
  } else if (intensityLow && tssLow) {
    recs.push(
      `No intensity yet and only ${stats.totalTSS} TSS — looks like a recovery week, not a ${phase}. Either lock it in as Recovery (drop a session) or add a threshold/VO2 day to hit ${tssMin}+ TSS${ctlNote}.`,
    )
  } else if (intensityLow) {
    recs.push(
      `Only ${stats.intensity} intensity ${stats.intensity === 1 ? 'day' : 'days'} — a ${phase} week typically has ${t.intensityMin}${t.intensityMax > t.intensityMin ? `–${t.intensityMax}` : ''}. Swap a Z2 day for a Threshold or VO2max session.`,
    )
  } else if (tssLow) {
    const gap = tssMin - stats.totalTSS
    recs.push(
      `Weekly TSS ${stats.totalTSS} is light for a ${phase} week — target ${tssMin}–${tssMax}${ctlNote}. Add ~${gap} TSS by extending a Z2 session or adding a long ride.`,
    )
  } else if (tssHigh) {
    recs.push(
      `Weekly TSS ${stats.totalTSS} is high for a ${phase} week — target ${tssMin}–${tssMax}${ctlNote}. Watch ATL; drop one session by 15–30 min if fatigue piles up.`,
    )
  } else if (polarizationOff) {
    // Intensity count is fine but the time-share is still off — tempo runs
    // can land you here.
    recs.push(
      `${Math.round(intensityPct)}% of riding time is hard — above the ~80/20 polarized norm. Lengthen the easy days rather than cutting intensity.`,
    )
  }

  if (stats.rest < t.restMin) {
    recs.push('No rest day this week. Schedule at least one full off-day so adaptation can happen.')
  }

  if (recs.length === 0) {
    recs.push(`Numbers line up with a ${phase} week. Stick to the schedule.`)
  }

  return recs
}

function computeWeekStats(template: PlanSession[]): WeekStats {
  let totalMinutes = 0
  let totalTSS = 0
  let sessions = 0
  let rest = 0
  let intensity = 0
  let easy = 0
  let easyMinutes = 0
  let intensityMinutes = 0
  for (const s of template) {
    const min = plannedSessionMinutes(s)
    totalMinutes += min
    totalTSS += plannedSessionTSS(s)
    if (s.type === 'rest') {
      rest++
    } else {
      sessions++
      if (INTENSITY_TYPES.includes(s.type)) {
        intensity++
        intensityMinutes += min
      } else {
        easy++
        easyMinutes += min
      }
    }
  }
  return {
    totalMinutes,
    totalTSS,
    sessions,
    rest,
    intensity,
    easy,
    easyMinutes,
    intensityMinutes,
  }
}

const RECOVERY_PLAN: PlanSession[] = [
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest', detail: 'Full off day', duration: '—', durationMinMin: 0, durationMaxMin: 30, powerFloor: null, powerCeiling: null, allowBelow: true },
  { type: 'opener', label: 'Opener', detail: 'Z2 with 3×1 min short openers', duration: '45 min', durationMinMin: 30, durationMaxMin: 60, powerFloor: 0.55, powerCeiling: 1.05, allowBelow: true },
  { type: 'test', label: 'Test ride', detail: 'Climb portal or structured effort if legs feel snappy', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 120, powerFloor: null, powerCeiling: null, allowBelow: true },
]

const BUILD_PLAN: PlanSession[] = [
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 100, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'threshold', label: 'Threshold', detail: '2×20 min at FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.7, powerCeiling: 1.05, allowBelow: false },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 100, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest or easy spin', detail: 'Full rest, or 30–45 min Z1', duration: '0–45 min', durationMinMin: 0, durationMaxMin: 50, powerFloor: null, powerCeiling: 0.6, allowBelow: true },
  { type: 'vo2', label: 'VO2max', detail: '5×4 min at 110–115% FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.65, powerCeiling: 1.1, allowBelow: false },
  { type: 'long', label: 'Long Z2', detail: 'Aerobic volume, flat or rolling', duration: '90–120 min', durationMinMin: 75, durationMaxMin: 150, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest', detail: 'Full off day', duration: '—', durationMinMin: 0, durationMaxMin: 30, powerFloor: null, powerCeiling: null, allowBelow: true },
]

// A paused week schedules nothing — every day is an unscored off day. Any
// riding still records TSS/fitness; it just isn't judged against a plan.
const PAUSED_PLAN: PlanSession[] = Array.from({ length: 7 }, () => ({
  type: 'rest' as SessionType,
  label: 'Paused',
  detail: 'Plan on hold — ride if you feel like it',
  duration: '—',
  durationMinMin: 0,
  durationMaxMin: 0,
  powerFloor: null,
  powerCeiling: null,
  allowBelow: true,
}))

type PlanPhase = 'recovery' | 'build' | 'paused'
type PlanPhaseSetting = 'auto' | PlanPhase

const PHASE_STORAGE_KEY = 'formlab:plan-phase'
const PLAN_START_STORAGE_KEY = 'formlab:plan-start-date'

/**
 * Recovery when form is still negative OR fatigue is still high.
 * Build only once both have recovered.
 *   - TSB < −3: form hasn't returned to neutral
 *   - ATL ≥ 65: fatigue still in "Heavy" territory
 */
function detectPhase(tsb: number | null, atl: number | null): PlanPhase {
  if (tsb === null) return 'build'
  if (tsb < -3) return 'recovery'
  if (atl !== null && atl >= 65) return 'recovery'
  return 'build'
}

const PHASE_META: Record<PlanPhase, { title: string; goalLabel: string; goalDetail: string }> = {
  recovery: {
    title: 'Recovery Consolidation',
    goalLabel: 'Goal',
    goalDetail: 'Form rebounds toward 0',
  },
  build: {
    title: 'Build Block',
    goalLabel: 'Goal',
    goalDetail: 'Fitness climbs while form stays neutral',
  },
  paused: {
    title: 'Plan Paused',
    goalLabel: 'Status',
    goalDetail: 'No sessions scheduled this week',
  },
}

const SESSION_COLORS: Record<SessionType, { bg: string; text: string; border: string; dot: string }> = {
  z2: { bg: 'bg-teal-500/10', text: 'text-teal-300', border: 'border-teal-500/30', dot: 'bg-teal-400' },
  rest: { bg: 'bg-neutral-500/10', text: 'text-neutral-400', border: 'border-neutral-500/30', dot: 'bg-neutral-500' },
  opener: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  test: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  threshold: { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  vo2: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30', dot: 'bg-rose-400' },
  long: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30', dot: 'bg-sky-400' },
  tempo: { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/30', dot: 'bg-yellow-400' },
  run: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  'tempo-run': { bg: 'bg-lime-500/10', text: 'text-lime-300', border: 'border-lime-500/30', dot: 'bg-lime-400' },
}

type FitVerdict = 'on-target' | 'below' | 'above' | 'over-duration' | 'under-duration' | 'rest-skipped' | 'pending' | 'none' | 'future' | 'paused'

const FIT_META: Record<FitVerdict, { label: string; tone: string; positive: boolean }> = {
  'paused': { label: 'Paused', tone: 'text-text-muted bg-bg-tertiary border-border-subtle', positive: true },
  'on-target': { label: 'On target', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', positive: true },
  'below': { label: 'Easier than planned', tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30', positive: true },
  'above': { label: 'Harder than planned', tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30', positive: false },
  'over-duration': { label: 'Over duration', tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30', positive: false },
  'under-duration': { label: 'Short', tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30', positive: true },
  'rest-skipped': { label: 'Rest skipped', tone: 'text-rose-300 bg-rose-500/10 border-rose-500/30', positive: false },
  'pending': { label: 'Pending', tone: 'text-accent bg-accent/10 border-accent/30', positive: true },
  'none': { label: 'Missed', tone: 'text-neutral-400 bg-neutral-500/10 border-neutral-500/30', positive: false },
  'future': { label: 'Upcoming', tone: 'text-text-muted bg-bg-tertiary border-border-subtle', positive: true },
}

interface DayActual {
  movingTimeMin: number
  avgPower: number | null
  np: number | null
  avgHr: number | null
  distance: number
  activities: StravaActivity[]
}

function aggregateDay(activities: StravaActivity[], date: Date): DayActual | null {
  const matches = activities.filter((a) => {
    const ad = new Date(a.start_date_local || a.start_date)
    return isSameDay(ad, date)
  })
  const summary = rollup(matches)
  if (!summary) return null

  return {
    movingTimeMin: summary.movingTime / 60,
    avgPower: summary.avgWatts ?? null,
    np: summary.normalizedWatts ?? null,
    avgHr: summary.avgHeartrate ?? null,
    distance: summary.distance,
    activities: matches,
  }
}

function computeFit(session: PlanSession, actual: DayActual | null, ftp: number): FitVerdict {
  // Rest day
  if (session.type === 'rest') {
    if (!actual) return 'on-target'
    // Short easy spin counts as compliant rest
    if (actual.movingTimeMin <= 30 && (actual.avgPower ?? 0) < ftp * 0.5) return 'on-target'
    return 'rest-skipped'
  }

  // Other sessions: need an activity
  if (!actual) return 'none'

  // Duration checks
  if (actual.movingTimeMin > session.durationMaxMin) return 'over-duration'
  if (actual.movingTimeMin < session.durationMinMin) return 'under-duration'

  // Power checks (when constrained)
  if (session.powerCeiling !== null && actual.avgPower !== null) {
    if (actual.avgPower > ftp * session.powerCeiling) return 'above'
  }
  if (session.powerFloor !== null && actual.avgPower !== null) {
    if (actual.avgPower < ftp * session.powerFloor) return 'below'
  }

  return 'on-target'
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h === 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Power/HR target string for a planned session, tuned to the user's live FTP and HR profile. */
function targetPowerLabel(
  session: PlanSession,
  ftp: number,
  z2HrCeiling: number,
  maxHR: number,
): string | null {
  // Approximate lactate threshold heart rate at ~88% of max — used for tempo
  // and threshold-style efforts when the rider has no power meter on the run.
  const lthr = Math.round(maxHR * 0.88)
  switch (session.type) {
    case 'z2':
    case 'long':
      return `${Math.round(ftp * 0.64)}–${Math.round(ftp * 0.75)}W · HR <${z2HrCeiling}`
    case 'tempo':
      return `${Math.round(ftp * 0.76)}–${Math.round(ftp * 0.9)}W · steady, sustained Z3`
    case 'threshold':
      return `intervals at ${Math.round(ftp * 0.95)}–${ftp}W`
    case 'vo2':
      return `intervals at ${Math.round(ftp * 1.1)}–${Math.round(ftp * 1.15)}W`
    case 'opener':
      return `short surges at ${Math.round(ftp * 0.95)}W near end`
    case 'run':
      return `HR <${z2HrCeiling} · easy / conversational`
    case 'tempo-run':
      return `HR ${z2HrCeiling}–${lthr} · steady, comfortably hard`
    case 'rest':
    case 'test':
    default:
      return null
  }
}

interface PlanDay {
  session: PlanSession
  date: Date
  actual: DayActual | null
  verdict: FitVerdict
  isToday: boolean
  isPastOrToday: boolean
}

interface WeekSummary {
  weekStart: Date
  weekEnd: Date
  phase: PlanPhase
  days: PlanDay[]
  adherencePct: number
  sessionsLogged: number
  scoredCount: number
  startSnap: { ctl: number; atl: number; tsb: number } | null
  endSnap: { ctl: number; atl: number; tsb: number } | null
  totalTimeMin: number
  totalActivities: number
  actualTSS: number
}

function summarizeWeek(
  weekStart: Date,
  today: Date,
  activities: StravaActivity[],
  fitnessSeries: Array<{ date: string; ctl: number; atl: number; tsb: number }>,
  thresholds: TssThresholds,
  phase: PlanPhase,
  dayOverrides?: Record<number, SessionType>,
): WeekSummary {
  const ftp = thresholds.ftp
  const paused = phase === 'paused'
  const baseTemplate = paused ? PAUSED_PLAN : phase === 'recovery' ? RECOVERY_PLAN : BUILD_PLAN
  // Day overrides don't apply to paused weeks — nothing is scheduled.
  const template =
    dayOverrides && !paused
      ? baseTemplate.map((s, i) =>
          i in dayOverrides ? SESSION_CATALOG[dayOverrides[i]] : s,
        )
      : baseTemplate

  const days: PlanDay[] = template.map((session, i) => {
    const date = addDays(weekStart, i)
    const isPastOrToday = date <= today
    const thisDayIsToday = isToday(date)
    const actual = isPastOrToday ? aggregateDay(activities, date) : null
    let verdict: FitVerdict
    if (paused) verdict = 'paused'
    else if (!isPastOrToday) verdict = 'future'
    else if (thisDayIsToday && !actual && session.type !== 'rest') verdict = 'pending'
    else verdict = computeFit(session, actual, ftp)
    return { session, date, actual, verdict, isToday: thisDayIsToday, isPastOrToday }
  })

  // Paused weeks score nothing — riding isn't "rest skipped", skipping isn't "missed".
  const scored = paused ? [] : days.filter((d) => d.isPastOrToday && d.verdict !== 'pending')
  const onPlan = scored.filter((d) => {
    if (d.verdict === 'on-target' || d.verdict === 'under-duration') return true
    if (d.verdict === 'below') return d.session.allowBelow
    return false
  }).length
  const adherencePct = scored.length > 0 ? Math.round((onPlan / scored.length) * 100) : 0
  const sessionsLogged = scored.filter((d) => d.actual !== null || d.session.type === 'rest').length

  const weekEnd = addDays(weekStart, 6)
  const startKey = format(subDays(weekStart, 1), 'yyyy-MM-dd')
  const endDate = weekEnd > today ? today : weekEnd
  const endKey = format(endDate, 'yyyy-MM-dd')
  // fitnessSeries carries one-decimal CTL/ATL/TSB; the plan UI shows these as
  // whole numbers, so round the snapshots here.
  const roundSnap = (p: { ctl: number; atl: number; tsb: number } | null | undefined) =>
    p ? { ctl: Math.round(p.ctl), atl: Math.round(p.atl), tsb: Math.round(p.tsb) } : null
  const startSnap = roundSnap(fitnessSeries.find((p) => p.date === startKey))
  const endSnap = roundSnap(
    fitnessSeries.find((p) => p.date === endKey) ??
      (fitnessSeries.length > 0 ? fitnessSeries[fitnessSeries.length - 1] : null),
  )

  const weekActivities = activities.filter((a) => {
    const ad = new Date(a.start_date_local || a.start_date)
    return ad >= weekStart && ad < addDays(weekStart, 7)
  })
  const totalTimeMin = weekActivities.reduce((s, a) => s + a.moving_time, 0) / 60
  const actualTSS = weekActivities.reduce((s, a) => s + calculateTSS(a, thresholds), 0)

  return {
    weekStart,
    weekEnd,
    phase,
    days,
    adherencePct,
    sessionsLogged,
    scoredCount: scored.length,
    startSnap,
    endSnap,
    totalTimeMin,
    totalActivities: weekActivities.length,
    actualTSS,
  }
}

function PlanPage() {
  const { athlete, activities, stats, maxHR, restingHR, tssThresholds } = useDashboard()

  const ftp = stats.ftp || 236
  const thresholds = useMemo<TssThresholds>(
    () => ({ ...tssThresholds, ftp }),
    [tssThresholds, ftp]
  )

  // Derived targets (from user's live FTP and HR)
  const z2HrCeiling = Math.round(restingHR + 0.7 * (maxHR - restingHR))
  const z2HrFloor = Math.round(restingHR + 0.6 * (maxHR - restingHR))
  const z2PowerLow = Math.round(ftp * 0.64)
  const z2PowerHigh = Math.round(ftp * 0.75)
  const thresholdLow = Math.round(ftp * 0.95)
  const thresholdHigh = Math.round(ftp * 1.0)
  const vo2Low = Math.round(ftp * 1.1)
  const vo2High = Math.round(ftp * 1.15)
  const atlTarget = 55

  // Full fitness history (for chart + current/baseline)
  const fitnessSeries = useMemo(() => {
    const history = estimateFTPHistory(activities)
    if (history.length === 0) return []
    return calculateFitnessOverTime(activities, history, tssThresholds)
  }, [activities, tssThresholds])

  // Plan week — Monday of this week through Sunday
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const weekStart = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  const dayIdx = differenceInDays(today, weekStart) // 0..6
  const elapsedDays = Math.min(dayIdx + 1, 7) // day-of-plan including today

  // Phase setting (persisted to localStorage, SSR-safe default = auto)
  const [phaseSetting, setPhaseSetting] = useState<PlanPhaseSetting>('auto')
  useEffect(() => {
    const stored = window.localStorage.getItem(PHASE_STORAGE_KEY)
    if (stored === 'auto' || stored === 'recovery' || stored === 'build') {
      setPhaseSetting(stored)
    }
  }, [])

  // Per-week phase overrides loaded from Supabase, keyed by week_start (yyyy-MM-dd)
  const [weekPhaseOverrides, setWeekPhaseOverrides] = useState<Record<string, PlanPhase>>({})
  const [overridesLoaded, setOverridesLoaded] = useState(false)
  useEffect(() => {
    if (!athlete || !isSupabaseConfigured()) {
      setOverridesLoaded(true)
      return
    }
    fetchPlanWeekPhases(athlete.id).then((rows) => {
      const map = Object.fromEntries(rows.map((r) => [r.weekStart, r.phase]))
      setWeekPhaseOverrides(map)
      const wsKey = format(weekStart, 'yyyy-MM-dd')
      if (wsKey in map) setPhaseSetting(map[wsKey])
      // Extend planStartDate to the earliest persisted week so saved phases
      // never render as "Pre-plan" after a reload or on a new device.
      if (rows.length > 0) {
        const earliestKey = rows.reduce(
          (min, r) => (r.weekStart < min ? r.weekStart : min),
          rows[0].weekStart,
        )
        const earliestDate = parseISO(earliestKey)
        setPlanStartDate((prev) => {
          if (!prev || earliestDate < prev) {
            try {
              window.localStorage.setItem(PLAN_START_STORAGE_KEY, earliestKey)
            } catch {
              // ignore
            }
            return earliestDate
          }
          return prev
        })
      }
      setOverridesLoaded(true)
    })
  }, [athlete, weekStart])

  // Per-day session-type overrides, keyed as `${weekStart YYYY-MM-DD}:${dayIndex}`
  const [dayOverrides, setDayOverrides] = useState<Record<string, SessionType>>({})
  // Which day card has its type-picker popover open (current week only)
  const [editingDayIdx, setEditingDayIdx] = useState<number | null>(null)
  useEffect(() => {
    if (!athlete || !isSupabaseConfigured()) return
    fetchPlanDayOverrides(athlete.id).then((rows) => {
      const map: Record<string, SessionType> = {}
      for (const r of rows) {
        // Validate session_type matches our enum
        if (r.sessionType in SESSION_CATALOG) {
          map[`${r.weekStart}:${r.dayIndex}`] = r.sessionType as SessionType
        }
      }
      setDayOverrides(map)
    })
  }, [athlete])

  const dayOverridesForWeek = (ws: Date): Record<number, SessionType> => {
    const wsKey = format(ws, 'yyyy-MM-dd')
    const out: Record<number, SessionType> = {}
    for (const [k, v] of Object.entries(dayOverrides)) {
      const [wk, idx] = k.split(':')
      if (wk === wsKey) out[Number(idx)] = v
    }
    return out
  }

  const setDayType = async (ws: Date, dayIndex: number, type: SessionType | null) => {
    const wsKey = format(ws, 'yyyy-MM-dd')
    const k = `${wsKey}:${dayIndex}`
    if (type === null) {
      setDayOverrides((prev) => {
        const next = { ...prev }
        delete next[k]
        return next
      })
      if (athlete && isSupabaseConfigured()) {
        await deletePlanDayOverride(athlete.id, wsKey, dayIndex)
      }
    } else {
      setDayOverrides((prev) => ({ ...prev, [k]: type }))
      if (athlete && isSupabaseConfigured()) {
        await upsertPlanDayOverride(athlete.id, wsKey, dayIndex, type)
      }
    }
  }

  // Plan start date — defaults to Monday of current week on first load.
  // Weeks before this are shown as "Pre-plan" in history (no phase/adherence).
  const [planStartDate, setPlanStartDate] = useState<Date | null>(null)
  useEffect(() => {
    const stored = window.localStorage.getItem(PLAN_START_STORAGE_KEY)
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
      // parseISO interprets a date-only string as local midnight, matching
      // what startOfWeek/subDays return. new Date(string) would parse as UTC
      // and break the < comparison against locally-anchored week starts.
      setPlanStartDate(parseISO(stored))
    } else {
      const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
      const key = format(monday, 'yyyy-MM-dd')
      window.localStorage.setItem(PLAN_START_STORAGE_KEY, key)
      setPlanStartDate(monday)
    }
  }, [])

  // Resolve active phase from the snapshot at week start, so the phase stays
  // stable Monday→Sunday and doesn't flip mid-week as new rides shift ATL/TSB.
  const weekStartSnap = useMemo(() => {
    const key = format(subDays(weekStart, 1), 'yyyy-MM-dd')
    return fitnessSeries.find((p) => p.date === key) ?? null
  }, [fitnessSeries, weekStart])
  const phaseTsb = weekStartSnap?.tsb ?? null
  const phaseAtl = weekStartSnap?.atl ?? null
  const autoPhase: PlanPhase = detectPhase(phaseTsb, phaseAtl)
  const activePhase: PlanPhase = phaseSetting === 'auto' ? autoPhase : phaseSetting

  // First time entering this week: persist 'paused' so every new week starts
  // paused until the user explicitly resumes it. Resuming re-locks the week to
  // the auto-detected phase; the DB row is the source of truth from here on.
  useEffect(() => {
    if (!overridesLoaded) return
    if (!athlete || !isSupabaseConfigured()) return
    if (fitnessSeries.length === 0) return
    const wsKey = format(weekStart, 'yyyy-MM-dd')
    if (wsKey in weekPhaseOverrides) return
    upsertPlanWeekPhase(athlete.id, wsKey, 'paused')
    setWeekPhaseOverrides((prev) => ({ ...prev, [wsKey]: 'paused' }))
    setPhaseSetting('paused')
  }, [overridesLoaded, athlete, weekStart, weekPhaseOverrides, fitnessSeries.length])

  const isPaused = activePhase === 'paused'

  // Pause/resume the plan for the current week. Persisted through the same
  // per-week phase row the auto-detect uses; resuming re-locks the week to
  // the phase the fitness numbers currently suggest.
  const setWeekPaused = async (paused: boolean) => {
    const wsKey = format(weekStart, 'yyyy-MM-dd')
    const next: PlanPhase = paused ? 'paused' : autoPhase
    setPhaseSetting(next)
    setWeekPhaseOverrides((prev) => ({ ...prev, [wsKey]: next }))
    if (athlete && isSupabaseConfigured()) {
      await upsertPlanWeekPhase(athlete.id, wsKey, next)
    }
  }

  // Current week (uses user-selected phase)
  const currentWeek = useMemo(
    () =>
      summarizeWeek(
        weekStart,
        today,
        activities,
        fitnessSeries,
        thresholds,
        activePhase,
        dayOverridesForWeek(weekStart),
      ),
    [weekStart, today, activities, fitnessSeries, thresholds, activePhase, dayOverrides],
  )
  const planDays = currentWeek.days
  const baseline = currentWeek.startSnap
  const fitnessNow = currentWeek.endSnap

  // Past weeks. Phase comes from the persisted per-week override if present;
  // otherwise auto-detected from TSB/ATL at the start of that week.
  const pastWeeks = useMemo(() => {
    if (fitnessSeries.length === 0) return []
    const out: WeekSummary[] = []
    for (let i = 1; i <= 12; i++) {
      const ws = subDays(weekStart, i * 7)
      const wsKey = format(ws, 'yyyy-MM-dd')
      const snapKey = format(subDays(ws, 1), 'yyyy-MM-dd')
      const snap = fitnessSeries.find((p) => p.date === snapKey)
      const phase: PlanPhase =
        weekPhaseOverrides[wsKey] ?? detectPhase(snap?.tsb ?? null, snap?.atl ?? null)
      const summary = summarizeWeek(
        ws,
        today,
        activities,
        fitnessSeries,
        thresholds,
        phase,
        dayOverridesForWeek(ws),
      )
      if (summary.totalActivities > 0) out.push(summary)
    }
    return out
  }, [weekStart, today, activities, fitnessSeries, thresholds, weekPhaseOverrides, dayOverrides])

  // Trajectory: 14 days ending today
  const trajectoryData = useMemo(() => {
    if (fitnessSeries.length === 0) return []
    const cutoff = format(subDays(today, 13), 'yyyy-MM-dd')
    return fitnessSeries
      .filter((p) => p.date >= cutoff)
      .map((p) => ({
        date: p.date,
        label: format(new Date(p.date), 'd. MMM', { locale: da }),
        ctl: Math.round(p.ctl),
        atl: Math.round(p.atl),
        tsb: Math.round(p.tsb),
        isWeek: p.date >= format(weekStart, 'yyyy-MM-dd'),
      }))
  }, [fitnessSeries, today, weekStart])

  // Current week adherence (from summary helper)
  const { adherencePct, sessionsLogged, scoredCount } = currentWeek
  const onPlanCount = Math.round((adherencePct / 100) * scoredCount)

  // Rolling weekly TSS estimate: actual where days are done, planned for the rest.
  // Updates as activities land instead of staying frozen at the template estimate.
  const rollingEstTSS = Math.round(
    currentWeek.days.reduce((s, d) => {
      if (d.actual) return s + d.actual.activities.reduce((x, a) => x + calculateTSS(a, thresholds), 0)
      return s + plannedSessionTSS(d.session)
    }, 0),
  )

  const atlDelta = baseline && fitnessNow ? fitnessNow.atl - baseline.atl : null
  const tsbDelta = baseline && fitnessNow ? fitnessNow.tsb - baseline.tsb : null
  const atlProgressToGoal = baseline && fitnessNow
    ? Math.max(0, Math.min(100, Math.round(
        ((baseline.atl - fitnessNow.atl) / Math.max(1, baseline.atl - atlTarget)) * 100,
      )))
    : 0

  return (
    <div className="flex flex-col gap-8">
      {/* Intro */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        <h2 className="text-2xl font-semibold text-text-primary mb-2 max-[480px]:text-xl">
          Training Plan
        </h2>
        <p className="text-text-secondary text-sm leading-relaxed max-w-2xl">
          Recovery-first week to bleed off accumulated fatigue, then a repeatable weekly structure
          that adds real threshold and VO2max work without blowing up CTL.
        </p>
      </div>

      {/* Progress summary */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">
            Plan Progress
          </h3>
          <span className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold data-value">
            Week of {format(weekStart, 'd. MMM', { locale: da })} – {format(weekEnd, 'd. MMM', { locale: da })}
          </span>
        </div>

        {/* Week progress bar */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-text-secondary">
              Day <span className="text-text-primary font-semibold data-value">{elapsedDays}</span> of{' '}
              <span className="text-text-primary font-semibold data-value">7</span>
            </span>
            <span className="text-xs text-text-muted data-value">
              {Math.round((elapsedDays / 7) * 100)}% through the week
            </span>
          </div>
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden relative">
            <div
              className="h-full bg-linear-to-r from-accent to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${(elapsedDays / 7) * 100}%` }}
            />
            {/* Day markers */}
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="absolute top-0 h-full w-px bg-bg-secondary/60"
                style={{ left: `${(n / 7) * 100}%` }}
              />
            ))}
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-[480px]:grid-cols-1">
          <StatTile
            big={scoredCount === 0 ? '—' : `${sessionsLogged}/${scoredCount}`}
            label="Sessions logged"
            hint={
              isPaused
                ? 'Plan paused'
                : scoredCount === 0
                  ? 'Week just started'
                  : `${scoredCount - sessionsLogged} missed · today pending`
            }
            accentPositive={scoredCount > 0 && sessionsLogged === scoredCount}
          />
          <StatTile
            big={scoredCount === 0 ? '—' : `${adherencePct}%`}
            label="On-plan adherence"
            hint={
              isPaused
                ? 'Plan paused'
                : scoredCount === 0
                  ? 'No completed days yet'
                  : `${onPlanCount} of ${scoredCount} within target`
            }
            accentPositive={adherencePct >= 75}
          />
          <StatTile
            big={
              baseline && fitnessNow
                ? `${baseline.atl} → ${fitnessNow.atl}`
                : '—'
            }
            label="ATL this week"
            hint={
              atlDelta !== null
                ? `${atlDelta <= 0 ? '↓' : '↑'} ${Math.abs(atlDelta)} toward target ${atlTarget}`
                : 'No baseline'
            }
            accentPositive={atlDelta !== null && atlDelta < 0}
          />
          <StatTile
            big={
              baseline && fitnessNow
                ? `${baseline.tsb} → ${fitnessNow.tsb}`
                : '—'
            }
            label="Form (TSB)"
            hint={
              tsbDelta !== null
                ? `${tsbDelta >= 0 ? '↑' : '↓'} ${Math.abs(tsbDelta)} toward 0`
                : 'No baseline'
            }
            accentPositive={tsbDelta !== null && tsbDelta > 0}
          />
        </div>

        {/* ATL → goal progress bar */}
        {baseline && fitnessNow && baseline.atl > atlTarget && (
          <div className="mt-6 pt-6 border-t border-border-subtle">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-text-muted uppercase tracking-wider font-semibold">
                Recovery goal
              </span>
              <span className="text-xs text-text-muted data-value">
                {atlProgressToGoal}% of the way from ATL {baseline.atl} → {atlTarget}
              </span>
            </div>
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${atlProgressToGoal}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Recovery trajectory chart */}
      {trajectoryData.length >= 3 && (
        <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
          <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">
              Recovery Trajectory
            </h3>
            <span className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">
              14 days · fatigue bleeding off
            </span>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={trajectoryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="atlFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartTheme.colors.amber.main} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={chartTheme.colors.amber.main} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tsbFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartTheme.colors.secondary.main} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartTheme.colors.secondary.main} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke={chartTheme.axis}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                />
                <YAxis
                  stroke={chartTheme.axis}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                  width={32}
                />
                <Tooltip {...tooltipStyle} />
                <ReferenceLine
                  y={atlTarget}
                  stroke={chartTheme.colors.semantic.positive}
                  strokeDasharray="4 4"
                  label={{ value: 'ATL goal', fill: chartTheme.colors.semantic.positive, fontSize: 10, position: 'right' }}
                />
                <ReferenceLine
                  y={0}
                  stroke={chartTheme.colors.neutral[500]}
                  strokeDasharray="2 4"
                />
                <Area
                  type="monotone"
                  dataKey="atl"
                  name="Fatigue (ATL)"
                  stroke={chartTheme.colors.amber.main}
                  strokeWidth={2}
                  fill="url(#atlFill)"
                />
                <Area
                  type="monotone"
                  dataKey="ctl"
                  name="Fitness (CTL)"
                  stroke={chartTheme.colors.primary.main}
                  strokeWidth={2}
                  fill="none"
                />
                <Area
                  type="monotone"
                  dataKey="tsb"
                  name="Form (TSB)"
                  stroke={chartTheme.colors.secondary.main}
                  strokeWidth={2}
                  fill="url(#tsbFill)"
                />
                <Legend
                  wrapperStyle={{ fontSize: '0.75rem', paddingTop: '8px' }}
                  iconType="line"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[0.7rem] text-text-muted leading-relaxed mt-4">
            Fatigue (ATL) coming down while fitness (CTL) holds is the signature of a successful recovery block.
            Form (TSB) climbing toward 0 means you'll be ready to push again.
          </p>
        </div>
      )}

      {/* This Week — enhanced with actuals */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        {(() => {
          const template = planDays.map((d) => d.session)
          const derived = classifyDerivedPhase(template)
          const meta = isPaused ? PAUSED_WEEK_META : DERIVED_PHASE_META[derived]
          const stats = computeWeekStats(template)
          const totalNonRest = stats.easyMinutes + stats.intensityMinutes
          const easyPct = totalNonRest > 0 ? (stats.easyMinutes / totalNonRest) * 100 : 0
          const intensityPct = totalNonRest > 0 ? (stats.intensityMinutes / totalNonRest) * 100 : 0
          return (
            <>
              <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">This Week</h3>
                  <span className={`text-[0.7rem] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${meta.tone}`}>
                    {meta.title}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {!isPaused && (
                    <span className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold max-[480px]:hidden">
                      Planned vs actual
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setWeekPaused(!isPaused)}
                    className={`text-[0.7rem] font-semibold px-2.5 py-1 rounded border transition-colors ${
                      isPaused
                        ? 'text-accent border-accent/40 bg-accent/10 hover:bg-accent/20'
                        : 'text-text-muted border-border-subtle hover:text-text-secondary hover:bg-bg-tertiary'
                    }`}
                    title={isPaused ? 'Resume the plan for this week' : 'Pause the plan for this week — no sessions, nothing counts as missed'}
                  >
                    {isPaused ? '▶ Resume plan' : '⏸ Pause week'}
                  </button>
                </div>
              </div>
              {isPaused ? (
                <div className="bg-bg-tertiary border border-border-subtle rounded-[var(--radius-md)] p-4 mb-2">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {PAUSED_WEEK_META.description}
                  </p>
                  <p className="text-[0.7rem] text-text-muted leading-relaxed mt-2">
                    This week won't count against adherence in Plan History. Resuming re-locks the
                    week to the phase your current fitness numbers suggest
                    {phaseTsb !== null && (
                      <> · TSB <span className="data-value">{phaseTsb >= 0 ? '+' : ''}{phaseTsb}</span></>
                    )}
                    {phaseAtl !== null && (
                      <> · ATL <span className="data-value">{phaseAtl}</span></>
                    )}
                  </p>
                </div>
              ) : (
              <p className="text-[0.7rem] text-text-muted leading-relaxed mb-4">
                {meta.description} · auto-classified from your selected sessions
                {phaseTsb !== null && (
                  <> · TSB <span className="data-value text-text-secondary">{phaseTsb >= 0 ? '+' : ''}{phaseTsb}</span></>
                )}
                {phaseAtl !== null && (
                  <> · ATL <span className="data-value text-text-secondary">{phaseAtl}</span></>
                )}
              </p>
              )}

              {isPaused ? null : (
              <>
              {/* Stats panel */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <StatTile
                  label="Planned time"
                  big={formatDuration(stats.totalMinutes)}
                  hint={`${stats.sessions} session${stats.sessions === 1 ? '' : 's'}`}
                  accentPositive={false}
                />
                <StatTile
                  label="Intensity"
                  big={`${stats.intensity}d`}
                  hint={stats.intensity === 0 ? 'aerobic only' : `${formatDuration(stats.intensityMinutes)} hard`}
                  accentPositive={false}
                />
                <StatTile
                  label="Rest"
                  big={`${stats.rest}d`}
                  hint={stats.rest === 0 ? 'no off-day' : 'recovery'}
                  accentPositive={false}
                />
                <StatTile
                  label="TSS"
                  big={`${Math.round(currentWeek.actualTSS)} / ${rollingEstTSS}`}
                  hint="actual / est."
                  accentPositive
                />
              </div>
              {totalNonRest > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
                    <span>Riding time mix</span>
                    <span className="data-value normal-case tracking-normal text-text-muted/70">
                      {Math.round(easyPct)}% easy · {Math.round(intensityPct)}% intensity
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden flex bg-bg-tertiary">
                    {easyPct > 0 && (
                      <div className="bg-teal-400" style={{ width: `${easyPct}%` }} title={`Easy ${formatDuration(stats.easyMinutes)}`} />
                    )}
                    {intensityPct > 0 && (
                      <div className="bg-rose-400" style={{ width: `${intensityPct}%` }} title={`Intensity ${formatDuration(stats.intensityMinutes)}`} />
                    )}
                  </div>
                </div>
              )}

              {/* Plan Recommendations */}
              {(() => {
                const currentCtl =
                  fitnessSeries.length > 0 ? Math.round(fitnessSeries[fitnessSeries.length - 1].ctl) : null
                const recs = buildPlanRecommendations(stats, derived, currentCtl)
                const inLine = recs.length === 1 && recs[0].startsWith('Numbers line up')
                return (
                  <div
                    className={`rounded-[var(--radius-md)] p-3 mb-4 border ${
                      inLine
                        ? 'bg-success-muted border-success/30'
                        : 'bg-bg-tertiary border-border-subtle'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[0.65rem] uppercase tracking-wider font-semibold text-text-muted">
                        Plan recommendations
                      </span>
                      {inLine ? (
                        <span className="text-[0.6rem] text-success uppercase tracking-wider">Balanced</span>
                      ) : (
                        <span className="text-[0.6rem] text-warning uppercase tracking-wider">{recs.length} suggestion{recs.length === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    <ol className="flex flex-col gap-1.5 list-decimal list-inside">
                      {recs.map((r, i) => (
                        <li
                          key={i}
                          className={`text-xs leading-relaxed marker:text-text-muted ${
                            inLine ? 'text-success' : 'text-text-secondary'
                          }`}
                        >
                          {r}
                        </li>
                      ))}
                    </ol>
                  </div>
                )
              })()}
              </>
              )}
            </>
          )
        })()}

        {(() => {
          if (isPaused) return null
          const shape = countWeekShape(planDays.map((d) => d.session))
          const target = PHASE_WEEK_TARGETS[activePhase]
          const issues: string[] = []
          if (shape.intensity > target.intensity + 1)
            issues.push(`${shape.intensity} intensity days (template ${target.intensity})`)
          if (shape.intensity < target.intensity - 1)
            issues.push(`${shape.intensity} intensity days (template ${target.intensity})`)
          if (shape.rest > target.rest + 1)
            issues.push(`${shape.rest} rest days (template ${target.rest})`)
          if (shape.rest < target.rest - 1)
            issues.push(`${shape.rest} rest days (template ${target.rest})`)
          if (issues.length === 0) return null
          return (
            <div className="bg-warning-muted border border-warning/30 rounded-[var(--radius-md)] p-3 mb-4 text-xs text-warning leading-relaxed">
              Weekly shape drift: {issues.join(' · ')}. Adjust day types to bring it back in line with a {activePhase} week.
            </div>
          )
        })()}

        {!isPaused && (
        <div className="grid grid-cols-7 gap-3 max-lg:grid-cols-4 max-md:grid-cols-2 max-[480px]:grid-cols-1">
          {planDays.map(({ session, date, actual, verdict, isToday: thisDayIsToday, isPastOrToday }, dayIdx) => {
            const colors = SESSION_COLORS[session.type]
            const fit = FIT_META[verdict]
            const dayKey = `${format(weekStart, 'yyyy-MM-dd')}:${dayIdx}`
            const isCustomized = dayKey in dayOverrides
            const editing = editingDayIdx === dayIdx
            return (
              <div
                key={date.toISOString()}
                className={`border ${colors.border} ${colors.bg} rounded-[var(--radius-md)] p-4 flex flex-col gap-2 transition-all duration-150 relative ${
                  thisDayIsToday ? 'ring-2 ring-accent/60 ring-offset-2 ring-offset-bg-secondary' : ''
                } ${!isPastOrToday ? 'opacity-75' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold">
                    {format(date, 'EEE', { locale: da })}
                    {thisDayIsToday && (
                      <span className="ml-1.5 text-accent">· Today</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[0.65rem] text-text-muted data-value">
                      {format(date, 'd. MMM', { locale: da })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingDayIdx(editing ? null : dayIdx)}
                      title="Change session type"
                      className="text-[0.7rem] text-text-muted hover:text-text-secondary transition-colors px-1 leading-none"
                    >
                      ⋯
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${colors.dot}`} />
                  <span className={`text-sm font-semibold ${colors.text}`}>{session.label}</span>
                  {isCustomized && (
                    <span className="text-[0.55rem] text-text-muted/70 italic" title="Customized for this week">·</span>
                  )}
                </div>

                {editing && (
                  <div className="absolute z-20 top-9 right-2 bg-bg-elevated border border-border rounded-[var(--radius-md)] shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[140px]">
                    {(Object.keys(SESSION_CATALOG) as SessionType[]).map((t) => {
                      const cat = SESSION_CATALOG[t]
                      const active = session.type === t
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setDayType(weekStart, dayIdx, t)
                            setEditingDayIdx(null)
                          }}
                          className={`text-left text-xs py-1 px-2 rounded transition-colors ${
                            active
                              ? 'bg-accent/15 text-accent'
                              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                          }`}
                        >
                          {cat.label}
                          <span className="text-[0.65rem] text-text-muted/70 ml-1">{cat.duration}</span>
                        </button>
                      )
                    })}
                    {isCustomized && (
                      <button
                        type="button"
                        onClick={() => {
                          setDayType(weekStart, dayIdx, null)
                          setEditingDayIdx(null)
                        }}
                        className="text-left text-[0.7rem] py-1 px-2 mt-0.5 border-t border-border-subtle text-text-muted hover:text-text-secondary transition-colors"
                      >
                        ↺ Reset to template
                      </button>
                    )}
                  </div>
                )}

                {/* ACTUAL — shown when an activity exists */}
                {actual && (() => {
                  const dayTSS = Math.round(actual.activities.reduce((s, a) => s + calculateTSS(a, thresholds), 0))
                  const plannedDayTSS = plannedSessionTSS(session)
                  return (
                    <div className="mt-1 pt-2 border-t border-border-subtle flex flex-col gap-1">
                      <div className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold">
                        Actual
                      </div>
                      <div className="text-xs text-text-primary data-value">
                        {formatDuration(actual.movingTimeMin)}
                        {actual.avgPower !== null && (
                          <>
                            <span className="text-text-muted mx-1">·</span>
                            {Math.round(actual.avgPower)}W
                          </>
                        )}
                        {actual.avgHr !== null && (
                          <>
                            <span className="text-text-muted mx-1">·</span>
                            {Math.round(actual.avgHr)} bpm
                          </>
                        )}
                      </div>
                      <div className="text-[0.7rem] text-text-secondary data-value">
                        TSS {dayTSS}
                        {plannedDayTSS > 0 && (
                          <span className="text-text-muted"> / {plannedDayTSS}</span>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* REST kept — past rest day with no activity */}
                {!actual && isPastOrToday && session.type === 'rest' && (
                  <div className="mt-1 pt-2 border-t border-border-subtle">
                    <div className="text-xs text-emerald-300/80 italic">Rested</div>
                  </div>
                )}

                {/* TARGET — future days, today-pending, past-missed non-rest */}
                {!actual && !(isPastOrToday && session.type === 'rest') && (() => {
                  const plannedDayTSS = plannedSessionTSS(session)
                  return (
                    <div className="mt-1 pt-2 border-t border-border-subtle flex flex-col gap-1">
                      <div className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold">
                        Target
                      </div>
                      <div className="text-xs text-text-primary data-value">
                        {session.duration}
                      </div>
                      {targetPowerLabel(session, ftp, z2HrCeiling, maxHR) && (
                        <div className="text-[0.7rem] text-text-muted data-value">
                          {targetPowerLabel(session, ftp, z2HrCeiling, maxHR)}
                        </div>
                      )}
                      {plannedDayTSS > 0 && (
                        <div className="text-[0.7rem] text-text-secondary data-value">
                          TSS {plannedDayTSS}
                        </div>
                      )}
                      <div className="text-[0.7rem] text-text-muted leading-relaxed">
                        {session.detail}
                      </div>
                      {thisDayIsToday && !actual && session.type !== 'rest' && (
                        <div className="text-[0.7rem] text-accent italic">
                          Awaiting today's ride
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[0.7rem] text-text-muted data-value">{session.duration}</span>
                  <span
                    className={`text-[0.6rem] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${fit.tone}`}
                  >
                    {fit.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        )}

        {!isPaused && (
        <div className="mt-6 pt-6 border-t border-border-subtle grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <div>
            <div className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold mb-1">
              Power target
            </div>
            <div className="text-sm text-text-primary data-value">
              {z2PowerLow}–{z2PowerHigh}W
            </div>
            <div className="text-[0.7rem] text-text-muted mt-0.5">Endurance zone (64–75% FTP)</div>
          </div>
          <div>
            <div className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold mb-1">
              HR ceiling
            </div>
            <div className="text-sm text-text-primary data-value">{z2HrCeiling} bpm</div>
            <div className="text-[0.7rem] text-text-muted mt-0.5">
              Karvonen 70% · stay in Fat Burn zone
            </div>
          </div>
          <div>
            <div className="text-[0.65rem] text-text-muted uppercase tracking-wider font-semibold mb-1">
              {PHASE_META[activePhase].goalLabel}
            </div>
            <div className="text-sm text-text-primary">
              {activePhase === 'recovery'
                ? <>ATL {baseline?.atl ?? '—'} → ~{atlTarget}</>
                : <>CTL climbing · TSB −10 to +5</>}
            </div>
            <div className="text-[0.7rem] text-text-muted mt-0.5">
              {PHASE_META[activePhase].goalDetail}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Plan History */}
      {pastWeeks.length > 0 && (
        <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">
              Plan History
            </h3>
            <span className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">
              Last {pastWeeks.length} week{pastWeeks.length === 1 ? '' : 's'} · retrospective
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {pastWeeks.map((w) => {
              const isPrePlan = planStartDate !== null && w.weekStart < planStartDate
              const wsKey = format(w.weekStart, 'yyyy-MM-dd')
              const isOverridden = wsKey in weekPhaseOverrides
              return (
                <WeekHistoryRow
                  key={w.weekStart.toISOString()}
                  summary={w}
                  isPrePlan={isPrePlan}
                  isOverridden={isOverridden}
                />
              )
            })}
          </div>

          <p className="text-[0.7rem] text-text-muted leading-relaxed mt-4">
            {planStartDate && (
              <>
                Plan started <span className="data-value text-text-secondary">{format(planStartDate, 'd. MMM yyyy', { locale: da })}</span>.{' '}
              </>
            )}
            Weeks before that show raw training load (no adherence scoring). Plan weeks show phase
            and adherence against that week's template.
          </p>
        </div>
      )}

      {/* Weekly template (unchanged) */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
          <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">
            Ongoing Weekly Template
          </h3>
          <span className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">
            After recovery week · 5–7 sessions
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { type: 'long' as const, label: 'Long Z2', detail: 'Aerobic base volume · 1× per week', targets: `${z2PowerLow}–${z2PowerHigh}W · HR <${z2HrCeiling} · 90–120 min` },
            { type: 'z2' as const, label: 'Z2 Endurance × 2', detail: 'Easy aerobic · 2× per week', targets: `${z2PowerLow}–${z2PowerHigh}W · HR <${z2HrCeiling} · 60–90 min` },
            { type: 'threshold' as const, label: 'Threshold', detail: '2×20 min at FTP · 1× per week', targets: `${thresholdLow}–${thresholdHigh}W · ~60 min total` },
            { type: 'vo2' as const, label: 'VO2max', detail: '5×4 min hard · 1× per week', targets: `${vo2Low}–${vo2High}W · climb portal works well` },
            { type: 'rest' as const, label: 'Rest or easy spin', detail: 'Recovery · 1–2× per week', targets: '30–45 min very easy, or off' },
          ].map((session, i) => {
            const colors = SESSION_COLORS[session.type]
            return (
              <div
                key={i}
                className={`flex items-center gap-4 border ${colors.border} ${colors.bg} rounded-[var(--radius-md)] p-4 max-md:flex-col max-md:items-start max-md:gap-2`}
              >
                <div className="flex items-center gap-3 min-w-44 shrink-0">
                  <span className={`size-2.5 rounded-full ${colors.dot}`} />
                  <span className={`text-sm font-semibold ${colors.text}`}>{session.label}</span>
                </div>
                <div className="text-sm text-text-secondary flex-1 max-md:text-xs">{session.detail}</div>
                <div className="text-xs text-text-muted data-value max-md:text-[0.7rem]">
                  {session.targets}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zone reference */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        <h3 className="text-lg font-semibold text-text-primary mb-5 max-[480px]:text-base">
          Training Targets
        </h3>

        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <div className="border border-border-subtle bg-bg-tertiary/50 rounded-[var(--radius-md)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="size-2 rounded-full bg-teal-400" />
              <span className="text-sm font-semibold text-teal-300">Z2 Endurance</span>
            </div>
            <div className="text-2xl font-semibold text-text-primary data-value mb-1">
              {z2PowerLow}–{z2PowerHigh}
              <span className="text-sm text-text-muted font-normal ml-1">W</span>
            </div>
            <div className="text-xs text-text-muted">HR {z2HrFloor}–{z2HrCeiling} bpm</div>
            <div className="text-[0.7rem] text-text-muted mt-2 leading-relaxed">
              The bread and butter. Builds aerobic base without fatigue cost. Should feel easy.
            </div>
          </div>

          <div className="border border-border-subtle bg-bg-tertiary/50 rounded-[var(--radius-md)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="size-2 rounded-full bg-orange-400" />
              <span className="text-sm font-semibold text-orange-300">Threshold</span>
            </div>
            <div className="text-2xl font-semibold text-text-primary data-value mb-1">
              {thresholdLow}–{thresholdHigh}
              <span className="text-sm text-text-muted font-normal ml-1">W</span>
            </div>
            <div className="text-xs text-text-muted">95–100% FTP</div>
            <div className="text-[0.7rem] text-text-muted mt-2 leading-relaxed">
              Sustained hard. Intervals 10–20 min. This is the lever that raises FTP.
            </div>
          </div>

          <div className="border border-border-subtle bg-bg-tertiary/50 rounded-[var(--radius-md)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="size-2 rounded-full bg-rose-400" />
              <span className="text-sm font-semibold text-rose-300">VO2max</span>
            </div>
            <div className="text-2xl font-semibold text-text-primary data-value mb-1">
              {vo2Low}–{vo2High}
              <span className="text-sm text-text-muted font-normal ml-1">W</span>
            </div>
            <div className="text-xs text-text-muted">110–115% FTP</div>
            <div className="text-[0.7rem] text-text-muted mt-2 leading-relaxed">
              Short maximal. Intervals 3–6 min. Raises the ceiling — where your current curve is weakest.
            </div>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
        <h3 className="text-lg font-semibold text-text-primary mb-5 max-[480px]:text-base">
          Non-negotiables
        </h3>

        <ul className="flex flex-col gap-3">
          <Rule
            n="01"
            title="Trust the TSB number"
            body="Former high-volume athletes push through fatigue signals. When Form drops below −20, back off regardless of how legs feel."
          />
          <Rule
            n="02"
            title="80/20 intensity distribution"
            body="~80% of weekly time in Z2 or easier, ~20% at threshold or above. Currently you're at 3% threshold+ — that's the gap to close."
          />
          <Rule
            n="03"
            title="Recovery is non-optional"
            body="1 full rest day per week minimum. Breaking a streak reflex beats grinding into plateau."
          />
          <Rule
            n="04"
            title="Knee-safe cycling defaults"
            body="Avoid heavy standing climbs and sudden big-gear mashes. Keep cadence ≥80 rpm on hard efforts. Minimal running volume."
          />
        </ul>
      </div>
    </div>
  )
}

function StatTile({
  big,
  label,
  hint,
  accentPositive,
}: {
  big: string
  label: string
  hint: string
  accentPositive: boolean
}) {
  return (
    <div className="border border-border-subtle bg-bg-tertiary/50 rounded-[var(--radius-md)] p-4 flex flex-col gap-1">
      <div className={`text-2xl font-semibold data-value ${accentPositive ? 'text-accent' : 'text-text-primary'}`}>
        {big}
      </div>
      <div className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold">
        {label}
      </div>
      <div className="text-[0.7rem] text-text-muted leading-relaxed">{hint}</div>
    </div>
  )
}

function Rule({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="text-accent font-semibold text-sm mt-0.5 data-value shrink-0">{n}</span>
      <div>
        <div className="text-sm text-text-primary font-medium">{title}</div>
        <div className="text-xs text-text-muted mt-0.5 leading-relaxed">{body}</div>
      </div>
    </li>
  )
}

function WeekHistoryRow({
  summary,
  isPrePlan,
  isOverridden,
}: {
  summary: WeekSummary
  isPrePlan: boolean
  isOverridden?: boolean
}) {
  const { weekStart, weekEnd, phase, adherencePct, sessionsLogged, scoredCount, startSnap, endSnap, totalTimeMin, totalActivities, days, actualTSS } = summary

  const isPausedWeek = phase === 'paused'
  const ctlDelta = startSnap && endSnap ? endSnap.ctl - startSnap.ctl : null
  const atlDelta = startSnap && endSnap ? endSnap.atl - startSnap.atl : null
  const tsbDelta = startSnap && endSnap ? endSnap.tsb - startSnap.tsb : null
  const plannedTSS =
    isPrePlan || isPausedWeek ? null : computeWeekStats(days.map((d) => d.session)).totalTSS
  const actualTSSRounded = Math.round(actualTSS)

  const phaseTone = isPrePlan || isPausedWeek
    ? 'text-text-muted bg-bg-tertiary border-border-subtle'
    : phase === 'recovery'
      ? 'text-teal-300 bg-teal-500/10 border-teal-500/30'
      : 'text-orange-300 bg-orange-500/10 border-orange-500/30'

  const adherenceTone =
    adherencePct >= 75
      ? 'bg-linear-to-r from-emerald-500 to-teal-400'
      : adherencePct >= 50
        ? 'bg-linear-to-r from-amber-500 to-amber-400'
        : 'bg-linear-to-r from-rose-500 to-rose-400'

  return (
    <div className="border border-border-subtle bg-bg-tertiary/40 rounded-[var(--radius-md)] px-4 py-3 flex items-center gap-6 flex-wrap max-lg:gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3">
      {/* Date + badge */}
      <div className="min-w-40 shrink-0 flex items-center gap-3 max-md:justify-between">
        <div>
          <div className="text-sm text-text-primary font-medium data-value">
            {format(weekStart, 'd. MMM', { locale: da })} – {format(weekEnd, 'd. MMM', { locale: da })}
          </div>
          <div className="text-[0.7rem] text-text-muted">
            {formatDuration(totalTimeMin)} · {totalActivities} rides
          </div>
        </div>
        <span className={`text-[0.6rem] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${phaseTone}`}>
          {isPrePlan ? 'Pre-plan' : phase === 'recovery' ? 'Recovery' : phase === 'paused' ? 'Paused' : 'Build'}
          {isOverridden && !isPrePlan && <span className="ml-1 opacity-70">·</span>}
        </span>
      </div>

      {/* Middle: adherence bar OR training-load summary for pre-plan/paused */}
      {isPrePlan ? (
        <div className="flex-1 min-w-48 max-md:w-full text-xs text-text-muted leading-relaxed">
          Raw training load — no plan was in effect this week.
        </div>
      ) : isPausedWeek ? (
        <div className="flex-1 min-w-48 max-md:w-full text-xs text-text-muted leading-relaxed">
          Plan paused — no sessions were scheduled, nothing counted as missed.
        </div>
      ) : (
        <div className="flex-1 min-w-48 max-md:w-full">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm text-text-primary font-semibold data-value">{adherencePct}%</span>
            <span className="text-[0.7rem] text-text-muted">
              {sessionsLogged}/{scoredCount} sessions
            </span>
          </div>
          <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full ${adherenceTone} rounded-full transition-all duration-300`}
              style={{ width: `${adherencePct}%` }}
            />
          </div>
        </div>
      )}

      {/* Deltas — always shown */}
      <div className="flex gap-5 shrink-0 max-md:justify-between max-md:w-full">
        <TSSCell actual={actualTSSRounded} planned={plannedTSS} />
        <DeltaStat label="CTL" delta={ctlDelta} positiveUp />
        <DeltaStat label="ATL" delta={atlDelta} positiveUp={false} />
        <DeltaStat label="TSB" delta={tsbDelta} positiveUp />
      </div>
    </div>
  )
}

function TSSCell({ actual, planned }: { actual: number; planned: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 items-start">
      <span className="text-[0.6rem] text-text-muted uppercase tracking-wider font-semibold">TSS</span>
      <span className="text-xs font-semibold data-value text-text-primary">
        {actual}
        {planned !== null && (
          <span className="text-text-muted/70 font-normal"> / {planned}</span>
        )}
      </span>
    </div>
  )
}

function DeltaStat({ label, delta, positiveUp }: { label: string; delta: number | null; positiveUp: boolean }) {
  const isNull = delta === null
  const good = !isNull && (positiveUp ? delta >= 0 : delta <= 0)
  const arrow = isNull ? '' : delta === 0 ? '·' : delta > 0 ? '↑' : '↓'
  const color = isNull
    ? 'text-text-muted'
    : good
      ? 'text-emerald-300'
      : 'text-amber-300'

  return (
    <div className="flex flex-col gap-0.5 items-start">
      <span className="text-[0.6rem] text-text-muted uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-xs font-semibold data-value ${color}`}>
        {isNull ? '—' : `${arrow} ${Math.abs(delta)}`}
      </span>
    </div>
  )
}
