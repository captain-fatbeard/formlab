/**
 * Sanity checks for the Best Efforts row on Records.
 *
 * The page was showing 400 m in 2:11, 1 mile in 9:29 and **5K in 5:48** side by
 * side. The first two are consistent at roughly 5:30–6:00 per km; the third
 * would be a world record several times over, so it is a bad row rather than a
 * remarkable one. Rather than trusting the fastest time in each bucket, drop
 * the efforts that are not physically possible before taking the minimum.
 */

/**
 * The fastest a human has ever covered this distance, in metres per second,
 * with a little headroom. Anything above this is a data fault: a mislabelled
 * bucket, a paused-clock artefact, or a time that is actually a pace.
 */
export function maxPlausibleSpeed(distanceMeters: number): number {
  if (distanceMeters <= 100) return 12.5 // 100 m WR is 10.44 m/s
  if (distanceMeters <= 400) return 10.0 // 400 m WR is 9.30 m/s
  if (distanceMeters <= 1609) return 8.0 // mile WR is 7.28 m/s
  if (distanceMeters <= 5000) return 7.2 // 5000 m WR is 6.62 m/s
  if (distanceMeters <= 21097) return 6.5 // half marathon WR is 6.02 m/s
  return 6.0 // marathon WR is 5.72 m/s
}

/** True when a distance/time pair could actually have happened. */
export function isPlausibleEffort(distanceMeters: number, seconds: number): boolean {
  if (!(distanceMeters > 0) || !(seconds > 0)) return false
  return distanceMeters / seconds <= maxPlausibleSpeed(distanceMeters)
}

/**
 * Whether a best-effort bucket is named in imperial units. Every other figure
 * in the app is metric, so the mile buckets are hidden by default rather than
 * interleaved with 400 m and 5K.
 */
export function isImperialEffort(name: string): boolean {
  return /mile/i.test(name)
}
