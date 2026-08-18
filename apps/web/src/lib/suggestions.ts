import type { SiteIndexEntry } from './types'

/**
 * Empty-search-state suggestions: repeatable, `verified` bosses only — an
 * unbuilt override in `needs_review` has no business being someone's first
 * impression, and a one-time quest boss teaches a newcomer nothing about the
 * simulator's actual use.
 *
 * No drop-table-size or popularity field exists anywhere in the corpus (see
 * `docs/DECISIONS.md`'s suggested-bosses entry — checked, not assumed
 * absent). `aliases.length` is the only derivable prominence signal: a boss
 * with more recorded nicknames/variant spellings (Vorkath, the Godwars
 * generals) tends to be one people actually look up, where an obscure one
 * (Melzar the Mad) has none. Weighting by `1 + aliases.length` biases
 * gently toward those without hand-picking a list that would rot as the
 * corpus changes.
 *
 * Sampling is weighted, without replacement, via the Efraimidis-Spirakis
 * A-Res algorithm: each candidate gets a key `random()^(1/weight)`, and the
 * top `count` keys win. This is the standard construction for "weighted
 * pick k of n without replacement" — a running weighted draw-and-remove
 * would work too but is O(n·count) instead of O(n log n) for no benefit
 * here.
 */
export function pickSuggestedBosses(
  entries: readonly SiteIndexEntry[],
  count: number,
  random: () => number = Math.random
): SiteIndexEntry[] {
  const pool = entries.filter((entry) => entry.repeatable && entry.status === 'verified')
  const keyed = pool.map((entry) => {
    const weight = 1 + entry.aliases.length
    return { entry, key: Math.pow(random(), 1 / weight) }
  })
  keyed.sort((a, b) => b.key - a.key)
  return keyed.slice(0, count).map((k) => k.entry)
}
