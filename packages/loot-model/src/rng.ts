/**
 * Seedable PRNG (PROJECT_PLAN.md 8). Same seed plus same input equals same
 * output, always. `Math.random()` is never used anywhere in this package.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  nextFloat(): number
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number
}

/**
 * mulberry32. 32 bits of state, passes the usual smoke tests, and is fast
 * enough that 10M kills stay in the seconds range.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0

  const nextFloat = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    nextFloat,
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`nextInt requires a positive integer bound, got ${maxExclusive}`)
      }
      return Math.floor(nextFloat() * maxExclusive)
    },
  }
}
