import type { BossStatus, StatusTier, ValidationResult } from '@osrs-loot-simulator/loot-model'
import { watchlistEntryFor, type Watchlist } from './validate/watchlist.js'

/**
 * Derives `Boss.statusTier`/`statusReason` from the already-computed
 * `validation.checks` — never hand-classified per source. See
 * `packages/loot-model/src/schema.ts`'s `StatusTierSchema` for what each
 * tier means and `docs/DECISIONS.md`'s status-tier entry for the full
 * per-source mapping this function was checked against.
 *
 * Precedence matters: a source can fail more than one check (Ancient chest
 * fails both `not_on_watchlist` and `drops_covered`), and the watchlist
 * verdict — a human judgement about how close the mechanic is to done — is
 * more informative than a row count, so it's checked first.
 */

/** A `drops_covered` failure detail always starts "N of M wiki drop row(s)". */
const DROPS_COVERED_COUNTS = /^(\d+) of (\d+) wiki drop row/

/**
 * Below this missing/total ratio, a `drops_covered` gap reads as "a small
 * documented item or edge case" (kalphite-queen's one 256th-kill-guaranteed
 * drop, mad-angel's one wiki-bucket-lag item) rather than "a meaningful slice
 * of the table has no stated rate at all" (nex: 21 of 33, 64%).
 */
const MINOR_GAP_RATIO = 0.05

/**
 * A transcluded sub-table's rates overshooting its declared access rate by a
 * stated multiple (vorkath: "sum to 1.6665x its stated access rate") is a
 * quantified, already-modelled simplification — the model keeps the wiki's
 * own per-row rates rather than the (unmodelled) true single-access-roll
 * shape — not an unstated unknown.
 */
const QUANTIFIED_OVERSHOOT = /sums? to [\d.]+x its stated/

function findCheck(checks: ValidationResult['checks'], id: string) {
  return checks.find((c) => c.check === id)
}

export function deriveStatusTier(
  status: BossStatus,
  checks: ValidationResult['checks'],
  slug: string,
  watchlist: Watchlist
): { tier: StatusTier | null; reason: string | null } {
  if (status === 'manual_override') return { tier: null, reason: null }
  if (status === 'verified') return { tier: 'verified', reason: null }

  const notOnWatchlist = findCheck(checks, 'not_on_watchlist')
  if (notOnWatchlist !== undefined && !notOnWatchlist.ok) {
    const entry = watchlistEntryFor(watchlist, slug)
    if (entry !== null) return { tier: entry.tier, reason: entry.detail }
  }

  const dropsCovered = findCheck(checks, 'drops_covered')
  if (dropsCovered !== undefined && !dropsCovered.ok) {
    const match = DROPS_COVERED_COUNTS.exec(dropsCovered.detail ?? '')
    if (match !== null) {
      const missing = Number(match[1])
      const total = Number(match[2])
      const tier: StatusTier = missing / total < MINOR_GAP_RATIO ? 'minor_gaps' : 'unknown_scaling'
      return { tier, reason: dropsCovered.detail ?? null }
    }
  }

  const weightsSum = findCheck(checks, 'weights_sum')
  if (weightsSum !== undefined && !weightsSum.ok) {
    return { tier: 'minor_gaps', reason: weightsSum.detail ?? null }
  }

  const headingUnambiguous = findCheck(checks, 'heading_unambiguous')
  if (headingUnambiguous !== undefined && !headingUnambiguous.ok) {
    const tier: StatusTier = QUANTIFIED_OVERSHOOT.test(headingUnambiguous.detail ?? '')
      ? 'approximate'
      : 'unknown_scaling'
    return { tier, reason: headingUnambiguous.detail ?? null }
  }

  // needs_review with every check above passing would mean deterministicOk's
  // gate (parse-boss.ts) diverged from this function's view of it — a bug in
  // one of the two, not a real case to guess a tier for.
  throw new Error(`${slug}: needs_review but no failing check explains why`)
}
