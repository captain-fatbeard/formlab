import { describe, it, expect } from 'vitest'
import {
  groupSplits,
  splitSizeOptions,
  defaultSplitSize,
  fastestAndSlowest,
  type SplitRow,
} from '../splits'
import type { StravaSplit } from '../strava'

function split(n: number, over: Partial<StravaSplit> = {}): StravaSplit {
  return {
    split: n,
    distance: 1000,
    moving_time: 180,
    elapsed_time: 180,
    elevation_difference: 0,
    average_speed: 1000 / 180,
    pace_zone: 0,
    ...over,
  }
}

describe('splitSizeOptions / defaultSplitSize', () => {
  it('keeps per-km splits for a normal ride', () => {
    expect(splitSizeOptions(40)).toEqual([1])
    expect(defaultSplitSize(40)).toBe(1)
  })

  it('groups a long ride by default', () => {
    expect(splitSizeOptions(164)).toEqual([1, 5, 10])
    expect(defaultSplitSize(164)).toBe(10)
  })
})

describe('groupSplits', () => {
  const splits = [
    split(1, { average_heartrate: 140 }),
    split(2, { average_heartrate: 150, moving_time: 120 }),
    split(3, { elevation_difference: 25 }),
    split(4, { elevation_difference: -25 }),
    split(5, { distance: 500, moving_time: 90 }),
  ]

  it('passes single kilometres through untouched', () => {
    const rows = groupSplits(splits, 1)
    expect(rows).toHaveLength(5)
    expect(rows[0].label).toBe('1')
    expect(rows[0].heartrate).toBe(140)
  })

  it('sums distance, time and elevation over a block', () => {
    const [row] = groupSplits(splits, 5)
    expect(row.label).toBe('1–5')
    expect(row.distance).toBe(4500)
    expect(row.movingTime).toBe(180 + 120 + 180 + 180 + 90)
    expect(row.elevation).toBe(0)
  })

  it('weights heart rate by time, not by split count', () => {
    const [row] = groupSplits(splits, 5)
    // 140 over 180s and 150 over 120s → 144.
    expect(row.heartrate).toBe(144)
  })

  it('weights power by distance', () => {
    const [row] = groupSplits(splits, 5, [200, 300, null, null, 100])
    // 200 over 1000m, 300 over 1000m, 100 over 500m → 220.
    expect(row.power).toBe(220)
  })

  it('leaves power null when none was recorded', () => {
    expect(groupSplits(splits, 5)[0].power).toBeNull()
    expect(groupSplits(splits, 5, [null, null, null, null, null])[0].power).toBeNull()
  })

  it('labels a trailing partial block by its real range', () => {
    const rows = groupSplits(splits, 2)
    expect(rows.map((r) => r.label)).toEqual(['1–2', '3–4', '5'])
  })
})

describe('fastestAndSlowest', () => {
  const row = (label: string, movingTime: number, distance = 1000): SplitRow => ({
    label,
    distance,
    movingTime,
    elevation: 0,
    heartrate: null,
    power: null,
  })

  it('finds the extremes', () => {
    const rows = [row('1', 180), row('2', 150), row('3', 200), row('4', 175)]
    expect(fastestAndSlowest(rows)).toEqual({ fastest: 1, slowest: 2 })
  })

  it('ignores a short final split rather than crowning it', () => {
    const rows = [row('1', 180), row('2', 185), row('3', 190), row('4', 20, 120)]
    expect(fastestAndSlowest(rows).fastest).toBe(0)
  })

  it('says nothing about a ride too short to compare', () => {
    expect(fastestAndSlowest([row('1', 180), row('2', 150)])).toEqual({ fastest: -1, slowest: -1 })
  })
})
