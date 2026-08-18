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

  it('is deterministic under an injected random source, so the weighting is testable', () => {
    const entries = [entry({ slug: 'low', aliases: [] }), entry({ slug: 'high', aliases: ['h1', 'h2', 'h3'] })]
    // A fixed random() makes the A-Res key `u^(1/weight)` purely a function of
    // weight: higher weight -> key closer to 1 for the same u, so the
    // heavier-weighted entry always wins a tie-break random draw.
    const picked = pickSuggestedBosses(entries, 1, () => 0.5)
    expect(picked[0]?.slug).toBe('high')
  })
})
