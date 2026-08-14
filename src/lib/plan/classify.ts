import { plannedSessionMinutes, plannedSessionTSS } from './templates'
import {
  type DerivedPhase,
  type PlanPhase,
  type PlanSession,
  type SessionType,
  type WeekShape,
  type WeekStats,
} from './types'

/** Counted as intensity for polarization and weekly shape. */
export const INTENSITY_TYPES: SessionType[] = ['threshold', 'vo2', 'tempo', 'tempo-run']
export const EASY_TYPES: SessionType[] = ['z2', 'long', 'run']

/**
 * Hard-intensity types drive Peak classification. Tempo-run counts as
 * "non-easy" for polarization but doesn't on its own bump a week to Peak —
 * three tempo runs is still a Build week, three threshold/VO2 days is a Peak.
 */
export const HARD_INTENSITY_TYPES: SessionType[] = ['threshold', 'vo2']

/**
 * Recovery when form is still negative OR fatigue is still high; build only
 * once both have recovered.
 *   - TSB < −3: form hasn't returned to neutral
 *   - ATL ≥ 65: fatigue still in "Heavy" territory
 * With no fitness data at all, assume build rather than prescribing rest.
 */
export const RECOVERY_TSB_CEILING = -3
export const RECOVERY_ATL_FLOOR = 65

export function detectPhase(tsb: number | null, atl: number | null): PlanPhase {
  if (tsb === null) return 'build'
  if (tsb < RECOVERY_TSB_CEILING) return 'recovery'
  if (atl !== null && atl >= RECOVERY_ATL_FLOOR) return 'recovery'
  return 'build'
}

/** What the planned lineup actually looks like, whichever template it came
 * from. Cosmetic — storage still holds the binary PlanPhase. */
export function classifyDerivedPhase(template: PlanSession[]): DerivedPhase {
  const hardCount = template.filter((s) => HARD_INTENSITY_TYPES.includes(s.type)).length
  if (hardCount >= 3) return 'peak'
  if (hardCount >= 1) return 'build'
  return 'recovery'
}

export function countWeekShape(template: PlanSession[]): WeekShape {
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

export function computeWeekStats(template: PlanSession[]): WeekStats {
  const stats: WeekStats = {
    totalMinutes: 0, totalTSS: 0, sessions: 0, rest: 0,
    intensity: 0, easy: 0, easyMinutes: 0, intensityMinutes: 0,
  }
  for (const s of template) {
    const min = plannedSessionMinutes(s)
    stats.totalMinutes += min
    stats.totalTSS += plannedSessionTSS(s)
    if (s.type === 'rest') {
      stats.rest++
      continue
    }
    stats.sessions++
    if (INTENSITY_TYPES.includes(s.type)) {
      stats.intensity++
      stats.intensityMinutes += min
    } else {
      stats.easy++
      stats.easyMinutes += min
    }
  }
  return stats
}

/** Expected weekly counts per phase, derived from the default templates. */
export const PHASE_WEEK_TARGETS: Record<PlanPhase, WeekShape> = {
  recovery: { intensity: 0, easy: 4, rest: 1 },
  build: { intensity: 2, easy: 3, rest: 2 },
  paused: { intensity: 0, easy: 0, rest: 7 },
}

/** How far a customized week has drifted from its phase's expected shape.
 * Tolerance of ±1 in each dimension before it's worth mentioning. */
export interface ShapeDrift {
  dimension: keyof WeekShape
  actual: number
  expected: number
}

export const SHAPE_DRIFT_TOLERANCE = 1

export function shapeDrift(template: PlanSession[], phase: PlanPhase): ShapeDrift[] {
  const actual = countWeekShape(template)
  const expected = PHASE_WEEK_TARGETS[phase]
  const dims: Array<keyof WeekShape> = ['intensity', 'easy', 'rest']
  return dims
    .filter((d) => Math.abs(actual[d] - expected[d]) > SHAPE_DRIFT_TOLERANCE)
    .map((d) => ({ dimension: d, actual: actual[d], expected: expected[d] }))
}
