import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatDistance,
  formatDuration,
  formatClock,
  formatPacePerKm,
  formatSpeed,
  formatTempo,
  formatDateShort,
  formatDateFull,
  formatRelativeTime,
} from '../format'

describe('formatNumber', () => {
  it('groups thousands with a comma and uses a dot for decimals', () => {
    expect(formatNumber(10249)).toBe('10,249')
    expect(formatNumber(44.24, 1)).toBe('44.2')
  })

  it('never renders a negative zero', () => {
    expect(formatNumber(-0.04)).toBe('0')
    expect(formatNumber(-0)).toBe('0')
  })

  it('renders a dash for values that are not numbers', () => {
    expect(formatNumber(NaN)).toBe('–')
    expect(formatNumber(Infinity)).toBe('–')
  })
})

describe('formatDistance', () => {
  it('keeps one decimal below 100 km and drops it above', () => {
    expect(formatDistance(44.24)).toBe('44.2')
    expect(formatDistance(10249)).toBe('10,249')
  })
})

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(171 * 3600 + 45 * 60)).toBe('171h 45m')
    expect(formatDuration(45 * 60)).toBe('45m')
  })

  it('switches to days once hours stop meaning anything', () => {
    // The 715:46:14 of F03.
    expect(formatDuration(715 * 3600 + 46 * 60 + 14)).toBe('29d 19h')
  })
})

describe('formatClock', () => {
  it('keeps seconds for single efforts', () => {
    expect(formatClock(284)).toBe('4:44')
    expect(formatClock(3661)).toBe('1:01:01')
  })
})

describe('pace and speed', () => {
  it('formats running pace per km', () => {
    expect(formatPacePerKm(338)).toBe('5:38/km')
  })

  it('formats riding speed in km/h', () => {
    expect(formatSpeed(27.5)).toBe('27.5 km/h')
  })

  it('picks the instrument from the sport', () => {
    // 1 km in 2:11 — 27.5 km/h on a bike, unreadable as a pace.
    expect(formatTempo(1000, 131, 'ride')).toBe('27.5 km/h')
    expect(formatTempo(1000, 338, 'run')).toBe('5:38/km')
  })

  it('returns a dash rather than dividing by zero', () => {
    expect(formatTempo(0, 100, 'ride')).toBe('–')
    expect(formatTempo(1000, 0, 'run')).toBe('–')
  })
})

describe('dates', () => {
  it('renders English dates, not Danish ones', () => {
    expect(formatDateShort('2026-07-29T10:00:00')).toBe('29 Jul')
    expect(formatDateFull('2026-07-29T10:00:00')).toBe('29 Jul 2026')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-24T12:00:00Z').getTime()

  it('describes recent syncs in minutes', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 4 * 60_000, now)).toBe('4 min ago')
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe('3h ago')
    expect(formatRelativeTime(now - 50 * 3600_000, now)).toBe('2d ago')
  })
})
