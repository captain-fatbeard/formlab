// Sport identity lives in ./tss with classifySport — re-exported here so the
// existing import sites keep working. Don't add a second definition.
export { isRide, isRun } from './tss'

/**
 * How big a day was, in training load. Scores are TSS-like, so the bands follow
 * TSS semantics: ~100 ≈ one hour at threshold.
 *
 * The single definition of these bands. The activity list badges rides with
 * them and the training calendar shades days with them, so a colour on the
 * calendar means the same thing as the badge on the list.
 */
export const SCORE_BANDS = [
  { upTo: 60, label: 'Easy' },
  { upTo: 120, label: 'Moderate' },
  { upTo: 200, label: 'Solid' },
  { upTo: 300, label: 'Hard' },
  { upTo: Infinity, label: 'Epic' },
] as const

export type ScoreLabel = (typeof SCORE_BANDS)[number]['label']

/** Get a human-readable score label from a numeric ride score. */
export function getScoreLabel(score: number): ScoreLabel {
  return (SCORE_BANDS.find((b) => score < b.upTo) ?? SCORE_BANDS[SCORE_BANDS.length - 1]).label
}

/** CSS classes for score label badges */
export const scoreLabelClasses: Record<string, string> = {
  Epic: 'bg-epic-muted text-epic',
  Hard: 'bg-hard-muted text-hard',
  Solid: 'bg-solid-muted text-solid',
  Moderate: 'bg-moderate-muted text-moderate',
  Easy: 'bg-bg-tertiary text-text-muted',
}

/** CSS classes for activity type badges */
export const activityTypeClasses: Record<string, string> = {
  ride: 'bg-ride-muted text-ride',
  virtualride: 'bg-ride-muted text-ride',
  run: 'bg-run-muted text-run',
}
