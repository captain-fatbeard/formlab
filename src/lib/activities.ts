// Sport identity lives in ./tss with classifySport — re-exported here so the
// existing import sites keep working. Don't add a second definition.
export { isRide, isRun } from './tss'

/** Get a human-readable score label from a numeric ride score.
 * Scores are TSS-like training load, so bands follow TSS semantics:
 * ~100 ≈ one hour at threshold. */
export function getScoreLabel(score: number): string {
  if (score >= 300) return 'Epic'
  if (score >= 200) return 'Hard'
  if (score >= 120) return 'Solid'
  if (score >= 60) return 'Moderate'
  return 'Easy'
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
