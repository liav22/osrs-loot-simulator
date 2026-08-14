import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  type Boss,
  type SimContext,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'

/**
 * Phase 7 gate for Reward pool (`data/overrides/reward-pool.json` +
 * `data/tables/reward_pool_fish.json`).
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures, not merely that the mechanic be
 * modelled. This file is that check, run against the REAL generated document so
 * it fails if a future re-parse stops emitting any of it.
 *
 * Every assertion is pinned to a sentence or figure on the page (revid
 * 15208420):
 *
 *   "There is about a 45/80 chance to roll the fish sub-table."   — ===Fish===
 *
 *   "The pool rewards are unaffected by skill boosts; e.g. it is not possible
 *    to catch manta rays if the player's base Fishing level is below 81."
 *      — the lead
 *
 *   |dropversion = Levels 35-39,Levels 40-45,Levels 46-49,Levels 50-75,
 *                  Levels 76-78,Levels 79-80,Levels 81+          — the infobox
 *
 * Note the unit: this document is **per reward permit**, not per encounter.
 * `expectedDrops` below is therefore "per permit redeemed". See the override's
 * own `note` for why, and for what stays unmodelled (the points -> permits
 * rounding rule the page never states, which is why Reward pool remains
 * watchlisted and `needs_review`).
 */

let boss: Boss
let shared: ReadonlyMap<string, Table>

beforeAll(async () => {
  boss = BossSchema.parse(
    JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', 'reward-pool.json'), 'utf8'))
  )
  shared = await loadSharedTables()
})

function atFishingLevel(fishingLevel: number): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, members: true, fishingLevel }
}

/** Expected drops per permit for one item key, 0 when it cannot drop at all. */
function ratePerPermit(fishingLevel: number, itemKey: string): number {
  const result = expectedValue(boss, atFishingLevel(fishingLevel), { tables: shared })
  return result.items.find((item) => item.itemKey === itemKey)?.expectedDrops ?? 0
}

describe('Reward pool: the main table reconciles to the page', () => {
  it('the fish sub-table is reached 45/80 of the time, at every bracket', () => {
    // "There is about a 45/80 chance to roll the fish sub-table." 45/80 is
    // exactly 3600/6400, which is what the fish weights sum to.
    for (const level of [35, 40, 46, 50, 76, 79, 81, 99]) {
      const fishKeys = [
        'raw-herring', 'raw-mackerel', 'raw-pike', 'raw-salmon', 'raw-tuna',
        'raw-lobster', 'raw-bass', 'raw-swordfish', 'raw-shark',
        'raw-sea-turtle', 'raw-manta-ray',
      ]
      const total = fishKeys.reduce((sum, key) => sum + ratePerPermit(level, key), 0)
      expect(total, `fish share at Fishing ${level}`).toBeCloseTo(45 / 80, 10)
    }
  })

  it('spirit flakes are 1/4 and the casket is 1/20 per permit', () => {
    expect(ratePerPermit(81, 'spirit-flakes')).toBeCloseTo(1 / 4, 10)
    // `casket-reward-pool`, not `casket`: the drop row is "Casket (Reward
    // pool)" and item keys are the slugified item name, parenthetical and all.
    expect(ratePerPermit(81, 'casket-reward-pool')).toBeCloseTo(1 / 20, 10)
  })

  it('the main table sums to exactly 6,400 with no implicit remainder', () => {
    const main = boss.tables.find((table) => table.id === 'reward-pool:main')
    expect(main).toBeDefined()
    expect(main?.denominator).toBe(6400)
    const sum = (main?.entries ?? []).reduce(
      (acc, entry) => acc + (entry.rate.kind === 'weight' ? entry.rate.weight : 0),
      0
    )
    // An exact reconciliation is the whole reason this source could be modelled
    // at all — a shortfall would mean an implicit `nothing` the page never
    // mentions, and an overflow would mean the split is wrong.
    expect(sum).toBe(6400)
  })
})

describe('Reward pool: the seven Fishing brackets are mutually exclusive', () => {
  it("manta rays are unreachable below Fishing 81 — the page's own worked example", () => {
    // "it is not possible to catch manta rays if the player's base Fishing
    // level is below 81". This is the sharpest available check on the bracket
    // model: a one-sided `levelAtLeast` would still gate manta ray correctly,
    // but see the next test for what it would break.
    expect(ratePerPermit(80, 'raw-manta-ray')).toBe(0)
    expect(ratePerPermit(81, 'raw-manta-ray')).toBeGreaterThan(0)
  })

  it('a high-level player gets ONE bracket, not all seven', () => {
    // The failure a one-sided `>=` produces, and the reason `atMost` exists: at
    // Fishing 99 every bracket's lower bound is satisfied, so without an upper
    // bound all seven fire and the fish share would be 7x too large. Herring
    // only appears in the 35-39 bracket, so its absence at 99 is the assertion.
    expect(ratePerPermit(99, 'raw-herring')).toBe(0)
    expect(ratePerPermit(35, 'raw-herring')).toBeGreaterThan(0)
  })

  it('each bracket boundary moves the table exactly one step', () => {
    // Lobster is in brackets 2-6 (levels 40-80) and in neither 1 nor 7.
    expect(ratePerPermit(39, 'raw-lobster')).toBe(0)
    expect(ratePerPermit(40, 'raw-lobster')).toBeGreaterThan(0)
    expect(ratePerPermit(80, 'raw-lobster')).toBeGreaterThan(0)
    expect(ratePerPermit(81, 'raw-lobster')).toBe(0)
  })

  it('the top fish of each bracket carries the 540/6400 slot', () => {
    // Within every bracket the five weights are 900/810/720/630/540, so the
    // rarest fish of the bracket is 540/6400 overall. Checked at both ends.
    expect(ratePerPermit(35, 'raw-tuna')).toBeCloseTo(540 / 6400, 10)
    expect(ratePerPermit(81, 'raw-manta-ray')).toBeCloseTo(540 / 6400, 10)
    // ...and the commonest is 900/6400.
    expect(ratePerPermit(35, 'raw-herring')).toBeCloseTo(900 / 6400, 10)
    expect(ratePerPermit(81, 'raw-bass')).toBeCloseTo(900 / 6400, 10)
  })

  it('below Fishing 35 no bracket applies at all', () => {
    // Correct rather than a gap: the page states no bracket below 35, and
    // Tempoross cannot be entered below it. The fish mass simply goes
    // unclaimed, which the model expresses as the weighted table's implicit
    // `nothing` remainder.
    const anyFish = ['raw-herring', 'raw-tuna', 'raw-manta-ray']
      .reduce((sum, key) => sum + ratePerPermit(34, key), 0)
    expect(anyFish).toBe(0)
    // The rest of the table is unaffected — this is a fish-only gate.
    expect(ratePerPermit(34, 'spirit-flakes')).toBeCloseTo(1 / 4, 10)
  })
})

describe('Reward pool: the rare uniques', () => {
  it('the dragon harpoon and tiny tempor are 1/8,000 per permit', () => {
    expect(ratePerPermit(81, 'dragon-harpoon')).toBeCloseTo(1 / 8000, 12)
    expect(ratePerPermit(81, 'tiny-tempor')).toBeCloseTo(1 / 8000, 12)
  })

  it('rare uniques are unaffected by Fishing level', () => {
    // They sit outside the fish sub-table, so a level-35 and a level-99 player
    // see identical rates — which is what the page implies by never bracketing
    // them.
    expect(ratePerPermit(35, 'dragon-harpoon')).toBeCloseTo(
      ratePerPermit(99, 'dragon-harpoon'),
      12
    )
  })
})

describe('Reward pool: what is deliberately NOT modelled', () => {
  it('stays on the mechanics watchlist, so the document is needs_review', () => {
    // The points -> permits rounding rule ("with a chance at rounding up") is
    // not stated on the page, so the per-encounter mechanic is unmodelled and
    // `tempoross_points` stays a stub. Removing the watchlist entry to move the
    // counter would be exactly the failure the watchlist exists to prevent.
    expect(boss.status).toBe('needs_review')
    const watchlistCheck = boss.validation.checks.find((c) => c.check === 'not_on_watchlist')
    expect(watchlistCheck?.ok).toBe(false)
  })

  it('every other deterministic check passes', () => {
    // The point of the above: needs_review here means "one known-unknown
    // mechanic", not "the parse is shaky".
    for (const name of ['weights_sum', 'refs_resolve', 'rates_valid', 'qty_sane', 'items_known']) {
      const check = boss.validation.checks.find((c) => c.check === name)
      expect(check?.ok, `${name}: ${check?.detail}`).toBe(true)
    }
  })
})
