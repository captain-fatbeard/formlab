// One place that decides how a number, a duration and a date look.
//
// Before this module the Overview page could render the same unit three ways —
// `10.249 km` (da-DK), `4,512 km` (browser locale) and `44.2 km` (toFixed) —
// so the same character meant "thousands" and "decimal" within one screenful.
// Everything user-facing goes through here; `LOCALE` is the single switch.

import { format } from 'date-fns'
import { enGB } from 'date-fns/locale'

/** The app's one locale. Matches `<html lang="en">` in `routes/__root.tsx`. */
export const LOCALE = 'en-GB'

const DATE_LOCALE = enGB

const numberFormatters = new Map<number, Intl.NumberFormat>()

function formatter(decimals: number): Intl.NumberFormat {
  let cached = numberFormatters.get(decimals)
  if (!cached) {
    cached = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    numberFormatters.set(decimals, cached)
  }
  return cached
}

/** `1234.5` → `1,235`. Grouped thousands, dot for decimals, always. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '–'
  // -0.04 rounds to "-0", which reads as an error state rather than as zero.
  const rounded = Number(value.toFixed(decimals))
  return formatter(decimals).format(rounded === 0 ? 0 : rounded)
}

/** Kilometres, one decimal below 100 km and whole numbers above. No unit. */
export function formatDistance(km: number, decimals?: number): string {
  return formatNumber(km, decimals ?? (Math.abs(km) < 100 ? 1 : 0))
}

/** Metres of climbing. No unit. */
export function formatElevation(meters: number): string {
  return formatNumber(meters, 0)
}

/**
 * A duration a human reads at a glance: `45m`, `1h 45m`, `29d 19h`.
 * Use for totals. For a single effort where seconds matter, use `formatClock`.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–'
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  // Past ten days the hour count stops carrying meaning — 715h reads as noise.
  if (hours >= 240) {
    const days = Math.floor(hours / 24)
    return `${formatNumber(days)}d ${hours % 24}h`
  }
  if (hours > 0) return `${formatNumber(hours)}h ${minutes}m`
  return `${minutes}m`
}

/** `1:45:12` / `4:44` — for efforts and splits, where the seconds are the point. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Running pace, `5:38/km`. Rides get `formatSpeed` instead — see F04. */
export function formatPacePerKm(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '–'
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`
}

/** Speed in km/h — the instrument a rider actually reads. */
export function formatSpeed(kmh: number): string {
  if (!Number.isFinite(kmh) || kmh <= 0) return '–'
  return `${formatNumber(kmh, 1)} km/h`
}

/**
 * Pace or speed depending on the sport: a 2:11/km "pace" on a bike is a
 * correct number shown through the wrong instrument.
 */
export function formatTempo(
  distanceMeters: number,
  movingSeconds: number,
  sport: 'ride' | 'run'
): string {
  if (distanceMeters <= 0 || movingSeconds <= 0) return '–'
  if (sport === 'ride') return formatSpeed(distanceMeters / 1000 / (movingSeconds / 3600))
  return formatPacePerKm((movingSeconds / distanceMeters) * 1000)
}

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? new Date(date) : date
}

/** `29 Jul` */
export function formatDateShort(date: Date | string): string {
  return format(toDate(date), 'd MMM', { locale: DATE_LOCALE })
}

/** `29 Jul 2026` */
export function formatDateFull(date: Date | string): string {
  return format(toDate(date), 'd MMM yyyy', { locale: DATE_LOCALE })
}

/** `Wed 29 Jul 2026` — for a single date that needs its weekday. */
export function formatDateWithWeekday(date: Date | string): string {
  return format(toDate(date), 'EEE d MMM yyyy', { locale: DATE_LOCALE })
}

/** `Jul 2026` */
export function formatMonthYear(date: Date | string): string {
  return format(toDate(date), 'MMM yyyy', { locale: DATE_LOCALE })
}

/** Pass to `date-fns` `format()` calls that need a pattern of their own. */
export const dateFnsLocale = DATE_LOCALE

/** `4 min ago` / `just now` — for the sync indicator in the top bar. */
export function formatRelativeTime(from: Date | number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
