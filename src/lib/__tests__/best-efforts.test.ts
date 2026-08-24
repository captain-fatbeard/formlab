import { describe, it, expect } from 'vitest'
import { isPlausibleEffort, isImperialEffort, maxPlausibleSpeed } from '../best-efforts'

describe('isPlausibleEffort', () => {
  it('accepts ordinary club-runner times', () => {
    expect(isPlausibleEffort(400, 131)).toBe(true) // 400 m in 2:11
    expect(isPlausibleEffort(1609, 569)).toBe(true) // 1 mile in 9:29
    expect(isPlausibleEffort(5000, 1700)).toBe(true) // 5K in 28:20
  })

  it('rejects the 5K in 5:48 that started this', () => {
    expect(isPlausibleEffort(5000, 348)).toBe(false)
  })

  it('rejects zero and negative inputs rather than dividing by them', () => {
    expect(isPlausibleEffort(5000, 0)).toBe(false)
    expect(isPlausibleEffort(0, 100)).toBe(false)
    expect(isPlausibleEffort(-1, 100)).toBe(false)
  })

  it('still accepts a genuine world record', () => {
    expect(isPlausibleEffort(5000, 755)).toBe(true) // 12:35
    expect(isPlausibleEffort(400, 44)).toBe(true) // 43.03 s, rounded up
  })

  it('loosens the cap for shorter distances', () => {
    expect(maxPlausibleSpeed(100)).toBeGreaterThan(maxPlausibleSpeed(42195))
  })
})

describe('isImperialEffort', () => {
  it('spots the mile buckets', () => {
    expect(isImperialEffort('1 mile')).toBe(true)
    expect(isImperialEffort('1/2 mile')).toBe(true)
    expect(isImperialEffort('2 mile')).toBe(true)
  })

  it('leaves the metric ones alone', () => {
    expect(isImperialEffort('400m')).toBe(false)
    expect(isImperialEffort('5K')).toBe(false)
    expect(isImperialEffort('Half-Marathon')).toBe(false)
  })
})
