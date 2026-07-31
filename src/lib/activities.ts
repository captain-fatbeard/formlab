import { type StravaActivity } from './strava'

/** Filter activities to those within the last N days. If days is 0, return all. */
export function filterByDays(activities: StravaActivity[], days: number): StravaActivity[] {
  if (days === 0) return activities
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return activities.filter((a) => new Date(a.start_date) >= cutoff)
}

/** Check if an activity is a cycling activity */
export function isRide(a: StravaActivity): boolean {
  return a.type === 'Ride' || a.type === 'VirtualRide'
}

/** Check if an activity is a running activity */
export function isRun(a: StravaActivity): boolean {
  return a.type === 'Run'
}

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
