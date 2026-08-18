import { describe, expect, it } from 'vitest'
import { pickSuggestedBosses } from '../src/lib/suggestions'
import type { SiteIndexEntry } from '../src/lib/types'

function entry(overrides: Partial<SiteIndexEntry> = {}): SiteIndexEntry {
  return {
    slug: 'x',
    name: 'X',
    aliases: [],
    status: 'verified',
    statusTier: 'verified',
    repeatable: true,
    ...overrides,
  }
}

describe('pickSuggestedBosses', () => {
  it('excludes non-repeatable and non-verified sources', () => {
    const entries = [
      entry({ slug: 'a' }),
      entry({ slug: 'b', repeatable: false }),
      entry({ slug: 'c', status: 'needs_review', statusTier: 'minor_gaps' }),
      entry({ slug: 'd', status: 'manual_override', statusTier: null }),
    ]
    const picked = pickSuggestedBosses(entries, 4)
    expect(picked.map((e) => e.slug)).toEqual(['a'])
  })

  it('returns at most `count` entries, never duplicating one', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry({ slug: `s${i}` }))
    const picked = pickSuggestedBosses(entries, 4)
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((e) => e.slug)).size).toBe(4)
  })

  it('returns every candidate when the pool is smaller than the requested count', () => {
    const entries = [entry({ slug: 'a' }), entry({ slug: 'b' })]
    expect(pickSuggestedBosses(entries, 4)).toHaveLength(2)
  })

  it('is deterministic under an injected random source', () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry({ slug: `s${i}` }))
    // A constant random() drives a fixed, reproducible swap sequence through
    // the partial Fisher-Yates — not a claim about what real shuffling looks
    // like, just that the function is a pure fn of its `random` argument.
    const picked = pickSuggestedBosses(entries, 3, () => 0.5)
    expect(picked.map((e) => e.slug)).toEqual(pickSuggestedBosses(entries, 3, () => 0.5).map((e) => e.slug))
  })

  it('does not weight by aliases.length — reverted after checking the real corpus has none to weight by', () => {
    // See suggestions.ts's header comment: data/index.json has exactly one
    // aliased source project-wide, and it is never in this pool, so a
    // weighted sampler would be indistinguishable from uniform anyway. This
    // pins the simpler implementation rather than re-introducing weighting.
    const entries = [
      entry({ slug: 'low', aliases: [] }),
      entry({ slug: 'high', aliases: ['h1', 'h2', 'h3'] }),
    ]
    let highWins = 0
    for (let i = 0; i < 200; i++) {
      const picked = pickSuggestedBosses(entries, 1, Math.random)
      if (picked[0]?.slug === 'high') highWins += 1
    }
    // Uniform over 2 candidates: expect ~100/200. A weighted implementation
    // favoring `high` would push this well above that.
    expect(highWins).toBeGreaterThan(70)
    expect(highWins).toBeLessThan(130)
  })
})
