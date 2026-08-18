import { describe, expect, it } from 'vitest'
import type { ValidationResult } from '@osrs-loot-simulator/loot-model'
import { deriveStatusTier } from '../src/tier.js'
import { WatchlistSchema, type Watchlist } from '../src/validate/watchlist.js'

function checks(overrides: Partial<Record<string, { ok: boolean; detail?: string }>>): ValidationResult['checks'] {
  const all = [
    'weights_sum',
    'refs_resolve',
    'rates_valid',
    'qty_sane',
    'ev_matches',
    'items_known',
    'not_on_watchlist',
    'drops_covered',
    'heading_unambiguous',
  ] as const
  return all.map((check) => ({ check, ok: true, ...overrides[check] }))
}

const watchlist: Watchlist = WatchlistSchema.parse({
  watchlistVersion: 1,
  entries: [
    {
      lootSourceId: 'zalcano',
      title: 'Zalcano',
      mechanic: 'point_scaled',
      detail: 'Two curves the page never states.',
      tier: 'unknown_scaling',
      blockedBy: [],
    },
    {
      lootSourceId: 'chest-tombs-of-amascut',
      title: 'Chest (Tombs of Amascut)',
      mechanic: 'point_scaled',
      detail: 'Mostly modelled; five remnant challenge rewards are not.',
      tier: 'approximate',
      blockedBy: [],
    },
  ],
})

describe('deriveStatusTier', () => {
  it('is verified for a verified boss, with no reason to explain', () => {
    expect(deriveStatusTier('verified', checks({}), 'anything', watchlist)).toEqual({
      tier: 'verified',
      reason: null,
    })
  })

  it('has no tier for manual_override — a separate terminal state', () => {
    expect(deriveStatusTier('manual_override', checks({}), 'anything', watchlist)).toEqual({
      tier: null,
      reason: null,
    })
  })

  it('reads the watchlist entry’s own tier when not_on_watchlist fails, preferring it over other failures', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({
        not_on_watchlist: { ok: false, detail: 'point_scaled: ...' },
        drops_covered: { ok: false, detail: '5 of 50 wiki drop row(s) missing from the document: a, b' },
      }),
      'chest-tombs-of-amascut',
      watchlist
    )
    expect(result.tier).toBe('approximate')
    expect(result.reason).toContain('remnant challenge rewards')
  })

  it('a small drops_covered gap (<5%) is minor_gaps', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({ drops_covered: { ok: false, detail: '1 of 70 wiki drop row(s) missing from the document: Kq head (tattered)' } }),
      'kalphite-queen',
      watchlist
    )
    expect(result).toEqual({
      tier: 'minor_gaps',
      reason: '1 of 70 wiki drop row(s) missing from the document: Kq head (tattered)',
    })
  })

  it('a large drops_covered gap (>=5%) is unknown_scaling', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({ drops_covered: { ok: false, detail: '21 of 33 wiki drop row(s) missing from the document: a, b' } }),
      'nex',
      watchlist
    )
    expect(result.tier).toBe('unknown_scaling')
  })

  it('a weights_sum failure alone is minor_gaps', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({ weights_sum: { ok: false, detail: "table 'x:0' flat sums to 101, denominator 100" } }),
      'phosani-s-nightmare',
      watchlist
    )
    expect(result.tier).toBe('minor_gaps')
  })

  it('a quantified heading-unambiguous overshoot is approximate', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({
        heading_unambiguous: {
          ok: false,
          detail: 'whose rates sum to 1.6665x its stated access rate 3/150',
        },
      }),
      'vorkath',
      watchlist
    )
    expect(result.tier).toBe('approximate')
  })

  it('an unquantified heading-ambiguity guess is unknown_scaling', () => {
    const result = deriveStatusTier(
      'needs_review',
      checks({
        heading_unambiguous: {
          ok: false,
          detail: 'assumed mutually-exclusive (preroll) but this is a guess and needs a human check',
        },
      }),
      'zulrah',
      watchlist
    )
    expect(result.tier).toBe('unknown_scaling')
  })

  it('throws if needs_review but nothing explains why — a bug in the gate, not a tier to guess', () => {
    expect(() => deriveStatusTier('needs_review', checks({}), 'ghost', watchlist)).toThrow()
  })
})
