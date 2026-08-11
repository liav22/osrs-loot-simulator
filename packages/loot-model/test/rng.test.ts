import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/index'

function take(seed: number, n: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: n }, () => rng.nextFloat())
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    expect(take(12345, 20)).toEqual(take(12345, 20))
  })

  it('produces different streams for different seeds', () => {
    expect(take(1, 20)).not.toEqual(take(2, 20))
  })

  it('stays inside [0, 1)', () => {
    for (const value of take(99, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is roughly uniform', () => {
    const values = take(7, 200_000)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean).toBeGreaterThan(0.49)
    expect(mean).toBeLessThan(0.51)

    const buckets = new Array<number>(10).fill(0)
    for (const value of values) buckets[Math.floor(value * 10)]! += 1
    for (const count of buckets) {
      expect(count).toBeGreaterThan(values.length / 10 - 1500)
      expect(count).toBeLessThan(values.length / 10 + 1500)
    }
  })

  it('nextInt covers [0, max) and rejects bad bounds', () => {
    const rng = mulberry32(3)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(5)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(5)
      seen.add(value)
    }
    expect(seen.size).toBe(5)
    expect(() => rng.nextInt(0)).toThrow(RangeError)
    expect(() => rng.nextInt(2.5)).toThrow(RangeError)
  })

  it('normalises the seed the way a uint32 would', () => {
    expect(take(-1, 5)).toEqual(take(0xffffffff, 5))
  })
})
