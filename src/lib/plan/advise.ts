import { type DerivedPhase, type WeekStats } from './types'

/** Healthy weekly intensity/rest ranges per derived phase. */
export const PHASE_TARGETS: Record<DerivedPhase, {
  intensityMin: number
  intensityMax: number
  restMin: number
  intensityPctMax: number // share of riding time that should be hard
}> = {
  recovery: { intensityMin: 0, intensityMax: 0, restMin: 1, intensityPctMax: 5 },
  build: { intensityMin: 1, intensityMax: 2, restMin: 1, intensityPctMax: 25 },
  peak: { intensityMin: 2, intensityMax: 3, restMin: 1, intensityPctMax: 30 },
}

/** TSS bands as multiples of weekly maintenance (CTL × 7). Recovery sits below
 * maintenance so CTL drops, build is around it, peak slightly above. */
export const PHASE_TSS_FACTORS: Record<DerivedPhase, { min: number; max: number }> = {
  recovery: { min: 0.6, max: 0.85 },
  build: { min: 0.95, max: 1.25 },
  peak: { min: 1.15, max: 1.55 },
}

/** Absolute fallback ranges when there's no CTL yet (new account etc). */
export const PHASE_TSS_FALLBACK: Record<DerivedPhase, { min: number; max: number }> = {
  recovery: { min: 150, max: 320 },
  build: { min: 300, max: 500 },
  peak: { min: 450, max: 700 },
}

/** The decision behind a recommendation. Tests assert on this; the message is
 * the rendered wording. */
export type RecommendationKind =
  | 'intensity-high-volume-low'
  | 'intensity-high-polarization-off'
  | 'intensity-high'
  | 'intensity-low-volume-low'
  | 'intensity-low'
  | 'volume-low'
  | 'volume-high'
  | 'polarization-off'
  | 'no-rest-day'
  | 'on-plan'

export interface Recommendation {
  kind: RecommendationKind
  message: string
}

export interface TssBand {
  min: number
  max: number
  /** Weekly maintenance load (CTL × 7), or null when there's no CTL yet. */
  maintenance: number | null
}

/** Weekly TSS target for a phase, personalised against current CTL when
 * available and falling back to absolute ranges when it isn't. */
export function tssBandFor(phase: DerivedPhase, ctl: number | null): TssBand {
  const maintenance = ctl ? Math.round(ctl * 7) : null
  if (maintenance === null) {
    const f = PHASE_TSS_FALLBACK[phase]
    return { min: f.min, max: f.max, maintenance: null }
  }
  const f = PHASE_TSS_FACTORS[phase]
  return {
    min: Math.round(maintenance * f.min),
    max: Math.round(maintenance * f.max),
    maintenance,
  }
}

/**
 * What to change about this week, if anything.
 *
 * Overlapping problems are collapsed into one coherent fix rather than three
 * nags pointing at the same thing — hence the else-if chain, which is ordered
 * most-specific first.
 */
export function planRecommendations(
  stats: WeekStats,
  phase: DerivedPhase,
  ctl: number | null
): Recommendation[] {
  const recs: Recommendation[] = []
  const t = PHASE_TARGETS[phase]
  const totalNonRest = stats.easyMinutes + stats.intensityMinutes
  const intensityPct = totalNonRest > 0 ? (stats.intensityMinutes / totalNonRest) * 100 : 0

  const { min: tssMin, max: tssMax, maintenance } = tssBandFor(phase, ctl)
  const ctlNote = maintenance ? ` (maintenance ≈ ${maintenance} at CTL ${ctl})` : ''
  const range = `${t.intensityMin}${t.intensityMax > t.intensityMin ? `–${t.intensityMax}` : ''}`

  const tssLow = stats.totalTSS < tssMin
  const tssHigh = stats.totalTSS > tssMax
  const intensityHigh = stats.intensity > t.intensityMax
  const intensityLow = stats.intensity < t.intensityMin
  const polarizationOff = intensityPct > t.intensityPctMax && stats.intensity > 0

  if (intensityHigh && tssLow) {
    recs.push({
      kind: 'intensity-high-volume-low',
      message: `${stats.intensity} hard days but only ${stats.totalTSS} TSS — heavy on intensity, light on volume. Swap one threshold/VO2 for a long Z2: drops you to a polarized 80/20 mix and lifts weekly TSS toward target ${tssMin}–${tssMax}${ctlNote} in one move.`,
    })
  } else if (intensityHigh && polarizationOff) {
    recs.push({
      kind: 'intensity-high-polarization-off',
      message: `${stats.intensity} hard days = ${Math.round(intensityPct)}% of riding time at intensity (above the ~80/20 norm). Swap one threshold/VO2 for endurance.`,
    })
  } else if (intensityHigh) {
    recs.push({
      kind: 'intensity-high',
      message: `${stats.intensity} intensity days is heavy for a ${phase} week (typical ${range}). Swap one for endurance to protect recovery.`,
    })
  } else if (intensityLow && tssLow) {
    recs.push({
      kind: 'intensity-low-volume-low',
      message: `No intensity yet and only ${stats.totalTSS} TSS — looks like a recovery week, not a ${phase}. Either lock it in as Recovery (drop a session) or add a threshold/VO2 day to hit ${tssMin}+ TSS${ctlNote}.`,
    })
  } else if (intensityLow) {
    recs.push({
      kind: 'intensity-low',
      message: `Only ${stats.intensity} intensity ${stats.intensity === 1 ? 'day' : 'days'} — a ${phase} week typically has ${range}. Swap a Z2 day for a Threshold or VO2max session.`,
    })
  } else if (tssLow) {
    recs.push({
      kind: 'volume-low',
      message: `Weekly TSS ${stats.totalTSS} is light for a ${phase} week — target ${tssMin}–${tssMax}${ctlNote}. Add ~${tssMin - stats.totalTSS} TSS by extending a Z2 session or adding a long ride.`,
    })
  } else if (tssHigh) {
    recs.push({
      kind: 'volume-high',
      message: `Weekly TSS ${stats.totalTSS} is high for a ${phase} week — target ${tssMin}–${tssMax}${ctlNote}. Watch ATL; drop one session by 15–30 min if fatigue piles up.`,
    })
  } else if (polarizationOff) {
    // Intensity count is fine but the time-share is still off — tempo runs
    // can land you here.
    recs.push({
      kind: 'polarization-off',
      message: `${Math.round(intensityPct)}% of riding time is hard — above the ~80/20 polarized norm. Lengthen the easy days rather than cutting intensity.`,
    })
  }

  if (stats.rest < t.restMin) {
    recs.push({
      kind: 'no-rest-day',
      message: 'No rest day this week. Schedule at least one full off-day so adaptation can happen.',
    })
  }

  if (recs.length === 0) {
    recs.push({
      kind: 'on-plan',
      message: `Numbers line up with a ${phase} week. Stick to the schedule.`,
    })
  }

  return recs
}
