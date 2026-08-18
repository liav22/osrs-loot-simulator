import type { SiteIndexEntry } from './types'

/**
 * Empty-search-state suggestions: repeatable, `verified` bosses only — an
 * unbuilt override in `needs_review` has no business being someone's first
 * impression, and a one-time quest boss teaches a newcomer nothing about the
 * simulator's actual use.
 *
 * Plain random over that pool, deliberately not weighted. `aliases.length`
 * was tried first as a prominence proxy (a boss with more recorded
 * nicknames tends to be one people actually look up) and reverted after
 * checking it against the real corpus, not on suspicion: `data/index.json`
 * has exactly ONE source with any alias at all (`reward-pool`, which is
 * `needs_review` and never in this pool anyway) — every candidate in the
 * 45-source pool carries `aliases.length === 0`, so the weighted sampler was
 * mathematically identical to uniform random while looking like it did
 * something. A 20-load sample (80 picks) confirmed it in practice: 38 of 45
 * pool sources surfaced, with "Salarin the twisted" and "Eldric the Ice
 * King" appearing as often as Cerberus and Corporeal Beast — see
 * `docs/DECISIONS.md`'s suggested-bosses entry. No other derivable
 * prominence signal exists in the corpus either (checked, not assumed
 * absent), so plain random is the honest choice, not a fallback pending a
 * better one — revisit only if a real signal (drop-table size, view counts,
 * anything) actually gets added to `data/`.
 */
export function pickSuggestedBosses(
  entries: readonly SiteIndexEntry[],
  count: number,
  random: () => number = Math.random
): SiteIndexEntry[] {
  const pool = entries.filter((entry) => entry.repeatable && entry.status === 'verified')
  // Partial Fisher-Yates: only shuffle the first `count` positions, since
  // nothing downstream of them is ever read.
  const shuffled = [...pool]
  const limit = Math.min(count, shuffled.length)
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(random() * (shuffled.length - i))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, limit)
}
