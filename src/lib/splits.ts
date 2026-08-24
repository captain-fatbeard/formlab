import type { StravaSplit } from './strava'

/** One row of the splits table — either a single kilometre or a block of them. */
export interface SplitRow {
  /** `12` for a single km, `11–15` for a block. */
  label: string
  /** Metres covered. */
  distance: number
  movingTime: number
  /** Net elevation change over the row, in metres. */
  elevation: number
  /** Time-weighted average heart rate, or null when none was recorded. */
  heartrate: number | null
  /** Distance-weighted average power, or null. */
  power: number | null
}

/**
 * Per-kilometre splits are right for a 40 km ride and unusable for a 164 km
 * one, where they run to roughly eight thousand pixels of table. Above the
 * thresholds here the table groups by default and offers the finer sizes.
 */
export function splitSizeOptions(totalKm: number): number[] {
  if (totalKm <= 60) return [1]
  if (totalKm <= 120) return [1, 5]
  return [1, 5, 10]
}

/** The block size the table opens on for a ride of this length. */
export function defaultSplitSize(totalKm: number): number {
  if (totalKm <= 60) return 1
  if (totalKm <= 120) return 5
  return 10
}

/** Collapse per-kilometre splits into blocks of `size` kilometres. */
export function groupSplits(
  splits: StravaSplit[],
  size: number,
  powerPerKm?: Array<number | null> | null
): SplitRow[] {
  if (size <= 1) {
    return splits.map((split, i) => ({
      label: String(split.split),
      distance: split.distance,
      movingTime: split.moving_time,
      elevation: split.elevation_difference,
      heartrate: split.average_heartrate ?? null,
      power: powerPerKm?.[i] ?? null,
    }))
  }

  const rows: SplitRow[] = []
  for (let start = 0; start < splits.length; start += size) {
    const block = splits.slice(start, start + size)
    const distance = block.reduce((sum, s) => sum + s.distance, 0)
    const movingTime = block.reduce((sum, s) => sum + s.moving_time, 0)

    // Heart rate is averaged over time and power over distance, because that
    // is what each one is a rate of. A plain mean of the kilometre averages
    // would over-weight the short final kilometre of a ride.
    const hrBlock = block.filter((s) => s.average_heartrate != null)
    const hrTime = hrBlock.reduce((sum, s) => sum + s.moving_time, 0)
    const heartrate =
      hrTime > 0
        ? Math.round(
            hrBlock.reduce((sum, s) => sum + (s.average_heartrate ?? 0) * s.moving_time, 0) / hrTime
          )
        : null

    let power: number | null = null
    if (powerPerKm) {
      const values = block
        .map((s, i) => ({ watts: powerPerKm[start + i], distance: s.distance }))
        .filter((v): v is { watts: number; distance: number } => v.watts != null)
      const powerDistance = values.reduce((sum, v) => sum + v.distance, 0)
      if (powerDistance > 0) {
        power = Math.round(
          values.reduce((sum, v) => sum + v.watts * v.distance, 0) / powerDistance
        )
      }
    }

    const first = block[0].split
    const last = block[block.length - 1].split
    rows.push({
      label: first === last ? String(first) : `${first}–${last}`,
      distance,
      movingTime,
      elevation: block.reduce((sum, s) => sum + s.elevation_difference, 0),
      heartrate,
      power,
    })
  }
  return rows
}

/** Indices of the fastest and slowest rows by speed, ignoring short final blocks. */
export function fastestAndSlowest(rows: SplitRow[]): { fastest: number; slowest: number } {
  if (rows.length < 3) return { fastest: -1, slowest: -1 }

  // A 0.3 km final split is not the fastest kilometre of the ride, so rows
  // materially shorter than the rest are excluded from the comparison.
  const fullDistance = Math.max(...rows.map((r) => r.distance))
  const comparable = rows
    .map((row, index) => ({ index, speed: row.movingTime > 0 ? row.distance / row.movingTime : 0, distance: row.distance }))
    .filter((r) => r.speed > 0 && r.distance >= fullDistance * 0.9)

  if (comparable.length < 3) return { fastest: -1, slowest: -1 }

  let fastest = comparable[0]
  let slowest = comparable[0]
  for (const row of comparable) {
    if (row.speed > fastest.speed) fastest = row
    if (row.speed < slowest.speed) slowest = row
  }
  return { fastest: fastest.index, slowest: slowest.index }
}
