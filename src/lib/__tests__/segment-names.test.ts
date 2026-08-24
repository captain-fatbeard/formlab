import { describe, it, expect } from 'vitest'
import { isShouting, normalizeSegmentName, splitActivityPrefix } from '../segment-names'

describe('normalizeSegmentName', () => {
  it('calms an all-caps name down', () => {
    expect(normalizeSegmentName('BERNSTOFFSVEJ - FRA HANS JENSENS VEJ')).toBe(
      'Bernstoffsvej - fra Hans Jensens Vej'
    )
  })

  it('leaves ordinary names untouched', () => {
    expect(normalizeSegmentName('Alpe du Zwift')).toBe('Alpe du Zwift')
    expect(normalizeSegmentName('Col de la Madone')).toBe('Col de la Madone')
  })

  it('leaves short acronyms alone', () => {
    expect(normalizeSegmentName('KOM')).toBe('KOM')
    expect(isShouting('KOM')).toBe(false)
  })

  it('keeps Danish letters intact', () => {
    expect(normalizeSegmentName('ØSTERBRO RUNDT')).toBe('Østerbro Rundt')
  })
})

describe('splitActivityPrefix', () => {
  it('lifts the Zwift prefix out of the name', () => {
    expect(splitActivityPrefix('Zwift - Climb Portal: La Superbagneres')).toEqual({
      prefix: 'Zwift',
      rest: 'Climb Portal: La Superbagneres',
    })
  })

  it('leaves other names whole', () => {
    expect(splitActivityPrefix('Morning Ride')).toEqual({ prefix: null, rest: 'Morning Ride' })
  })
})
