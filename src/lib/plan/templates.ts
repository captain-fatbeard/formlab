import { type PlanPhase, type PlanSession, type SessionType } from './types'

/** Default session definition for each type, used when a day is overridden
 * to a different type than the template's default. */
export const SESSION_CATALOG: Record<SessionType, PlanSession> = {
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

export const RECOVERY_PLAN: PlanSession[] = [
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base, no surges', duration: '60–75 min', durationMinMin: 45, durationMaxMin: 85, powerFloor: 0.5, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest', detail: 'Full off day', duration: '—', durationMinMin: 0, durationMaxMin: 30, powerFloor: null, powerCeiling: null, allowBelow: true },
  { type: 'opener', label: 'Opener', detail: 'Z2 with 3×1 min short openers', duration: '45 min', durationMinMin: 30, durationMaxMin: 60, powerFloor: 0.55, powerCeiling: 1.05, allowBelow: true },
  { type: 'test', label: 'Test ride', detail: 'Climb portal or structured effort if legs feel snappy', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 120, powerFloor: null, powerCeiling: null, allowBelow: true },
]

export const BUILD_PLAN: PlanSession[] = [
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 100, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'threshold', label: 'Threshold', detail: '2×20 min at FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.7, powerCeiling: 1.05, allowBelow: false },
  { type: 'z2', label: 'Z2 Endurance', detail: 'Easy aerobic base', duration: '60–90 min', durationMinMin: 45, durationMaxMin: 100, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest or easy spin', detail: 'Full rest, or 30–45 min Z1', duration: '0–45 min', durationMinMin: 0, durationMaxMin: 50, powerFloor: null, powerCeiling: 0.6, allowBelow: true },
  { type: 'vo2', label: 'VO2max', detail: '5×4 min at 110–115% FTP', duration: '~60 min', durationMinMin: 40, durationMaxMin: 85, powerFloor: 0.65, powerCeiling: 1.1, allowBelow: false },
  { type: 'long', label: 'Long Z2', detail: 'Aerobic volume, flat or rolling', duration: '90–120 min', durationMinMin: 75, durationMaxMin: 150, powerFloor: 0.55, powerCeiling: 0.8, allowBelow: true },
  { type: 'rest', label: 'Rest', detail: 'Full off day', duration: '—', durationMinMin: 0, durationMaxMin: 30, powerFloor: null, powerCeiling: null, allowBelow: true },
]

/** A paused week schedules nothing — every day is an unscored off day. Any
 * riding still records TSS/fitness; it just isn't judged against a plan. */
export const PAUSED_PLAN: PlanSession[] = Array.from({ length: 7 }, () => ({
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

/**
 * The week's sessions for a phase, with any per-day overrides applied.
 * Overrides don't apply to a paused week — nothing is scheduled to override.
 */
export function templateFor(
  phase: PlanPhase,
  dayOverrides?: Record<number, SessionType>
): PlanSession[] {
  const base = phase === 'paused' ? PAUSED_PLAN : phase === 'recovery' ? RECOVERY_PLAN : BUILD_PLAN
  if (!dayOverrides || phase === 'paused') return base
  return base.map((s, i) => (i in dayOverrides ? SESSION_CATALOG[dayOverrides[i]] : s))
}

/**
 * Estimated training stress per minute by session type. Coarse — single-IF
 * approximations rather than per-interval modeling. Good enough for a weekly
 * ballpark in the Stats panel.
 *
 * Calibrated 2026-05-02 against this rider's actual upper-Z2 / IF~0.88
 * threshold pattern. The previous values were keyed to band-floor IFs and
 * consistently undershot real accumulation by 30–55%.
 */
export const TSS_PER_MIN: Record<SessionType, number> = {
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

export function plannedSessionMinutes(s: PlanSession): number {
  return (s.durationMinMin + s.durationMaxMin) / 2
}

export function plannedSessionTSS(s: PlanSession): number {
  return Math.round(plannedSessionMinutes(s) * TSS_PER_MIN[s.type])
}
