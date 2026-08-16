import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  defaultFormulaRegistry,
  expectedValue,
  simulate,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Chambers of Xeric (`data/overrides/ancient-chest.json`).
 *
 * This source has already shipped two structurally-clean, badly-wrong
 * documents: the pre-override generated document rolls its unique AND common
 * tables on EVERY kill unconditionally (a ~100%-unique-rate document, found
 * by the `DROPS_SECTION_TITLE` widening session), and this override's own
 * FIRST draft (an earlier research pass's proposed mapping) would have used a
 * flat 43-item/denominator-99 common table with literal quantity RANGES —
 * both individually reasonable-looking, both wrong, caught only by
 * cross-checking the fresh page against `Module:Chambers of Xeric
 * calculator` line by line rather than trusting either source alone. Every
 * test below is aimed at one of those two failure shapes specifically, not
 * just at "does a number match."
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures — `docs/OVERRIDES.md` step 3. This
 * file is that check, run against the REAL generated document so it fails if
 * a future re-parse stops emitting any of it.
 *
 * Every assertion is pinned to something cited in `docs/bosses/ancient-chest.md`
 * or verified directly against the fresh Ancient chest page / calculator
 * module this session:
 *
 *   "1% chance to obtain a unique loot ... for every 8,676 total points"    — ===Unique drop table===
 *   "capped at 65.7% (570,000 points)"                                      — ===Unique drop table===
 *   "855,000 points -> 65.7% first roll, then 32.85% second roll"           — ===Unique drop table===
 *   "Up to six unique rewards can be obtained per raid"                     — ===Unique drop table===
 *   "If one of these items is received, no common rewards are given"        — ===Unique drop table===
 *   Dexterous/Arcane prayer scroll 14/60 (Normal), 12/56 (Challenge)         — post-2026-08-12-patch weights
 *   "the two rolls cannot end on the same drop"                             — ===Common drop table===
 *   "33% of these herbs will drop as seeds instead (at a rate of N
 *    herbs per seed)"                                                        — per-herb citations
 *   "Common-loot scaling caps at 131,071 points"                            — page prose
 *   "Olmlet is only rolled when the player gets a broadcasted unique
 *    reward; with 26,025 points per raid, the Olmlet rate is ~1/1,765"      — ===Tertiary=== citation
 *   "The elite clue scroll is only rolled when the player does not get
 *    a broadcasted unique reward"                                           — ===Tertiary=== citation
 *
 * NOT asserted, because the override declines to model them: team/party
 * point allocation, Ancient tablet's precise "replaces one of the loot
 * rolls" substitution (modelled as an additional independent roll instead),
 * and Metamorphic dust's unstated time-completion threshold.
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', 'ancient-chest.json'), 'utf8'))
  return BossSchema.parse(raw)
}

function ctxWith(overrides: Partial<SimContext>): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, members: true, ...overrides }
}

const UNIQUE_KEYS = [
  'dexterous-prayer-scroll',
  'arcane-prayer-scroll',
  'twisted-buckler',
  'dragon-hunter-crossbow',
  'dinh-s-bulwark',
  'ancestral-hat',
  'ancestral-robe-top',
  'ancestral-robe-bottom',
  'dragon-claws',
  'elder-maul',
  'kodai-insignia',
  'twisted-bow',
]

function rateOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const ev = expectedValue(boss, ctx)
  return ev.items.find((d) => d.itemKey === itemKey)?.expectedDrops ?? 0
}

/**
 * Sum of expected per-raid DROP COUNT across the whole 12-item unique pool.
 * Equal to P(any unique this raid) only when points fund at most one roll
 * (below 570,000) — each of the up to 6 rolls is an INDEPENDENT Bernoulli, so
 * above that threshold this is the expected NUMBER of uniques, which can
 * exceed 1 (getting 2+ uniques in one raid is a real, cited possibility: "Up
 * to six unique rewards can be obtained per raid"). Use `anyUniqueProbability`
 * below for "does at least one unique happen" at high points.
 */
function uniqueChance(boss: Boss, ctx: SimContext): number {
  return UNIQUE_KEYS.reduce((sum, key) => sum + rateOf(boss, ctx, key), 0)
}

/** P(at least one unique this raid) = 1 - Π(1 - P(roll_n)), computed the same way `cox_points`'s `eliteClueMarginal`/`olmletMarginal` do internally. */
function anyUniqueProbability(ctx: SimContext): number {
  let survival = 1
  for (let rollIndex = 1; rollIndex <= 6; rollIndex++) {
    const p = defaultFormulaRegistry.get('cox_points')!({ kind: 'roll', rollIndex }, ctx)
    survival *= 1 - p
  }
  return 1 - survival
}

describe('CoX: the naive parse’s ~100%-unique-rate failure cannot recur', () => {
  it('never rolls both a unique AND a common item in the same kill', async () => {
    // This is the exact bug the pre-override generated document shipped:
    // ancient-chest:0 (uniques) and ancient-chest:1 (common) both fired on
    // every single kill, unconditioned. suppressesFollowing is what fixes
    // it; assert the fix directly on sampled output, not just on the
    // formula's own math.
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 400_000 }) // high points: frequent uniques
    const sim = simulate(boss, 20_000, ctx, 41)
    const commonKeys = new Set(['death-rune', 'grimy-ranarr-weed', 'ranarr-seed', 'coal', 'lizardman-fang'])
    let both = 0
    for (const kill of sim.log) {
      const hasUnique = kill.drops.some((d) => UNIQUE_KEYS.includes(d.itemKey))
      const hasCommon = kill.drops.some((d) => commonKeys.has(d.itemKey))
      if (hasUnique && hasCommon) both++
    }
    expect(both).toBe(0)
  })

  it('P(any unique) never exceeds 1, even when points fund several independent rolls', async () => {
    const ctx = ctxWith({ variant: 'normal' })
    for (const points of [0, 20_000, 131_071, 570_000, 3_420_000, 10_000_000]) {
      const p = anyUniqueProbability({ ...ctx, points })
      expect(p, `points=${points}`).toBeLessThanOrEqual(1)
      expect(p, `points=${points}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('a sampled raid never gets a common-table item once it has already gotten a unique', async () => {
    // The direct, sampled version of "no common rewards are given" — not just
    // that the two formulas compose correctly, but that suppressesFollowing
    // actually stops the chain in the real simulator.
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 700_000 }) // > one roll's cap, so uniques are frequent
    const sim = simulate(boss, 20_000, ctx, 73)
    let uniqueKills = 0
    let uniquePlusCommon = 0
    for (const kill of sim.log) {
      const hasUnique = kill.drops.some((d) => UNIQUE_KEYS.includes(d.itemKey))
      if (!hasUnique) continue
      uniqueKills++
      if (kill.drops.some((d) => d.itemKey === 'death-rune' || d.itemKey === 'coal')) uniquePlusCommon++
    }
    expect(uniqueKills).toBeGreaterThan(0)
    expect(uniquePlusCommon).toBe(0)
  })
})

describe('CoX: the unique roll reproduces the wiki’s stated rates', () => {
  it('is 1% per 8,676ish points below the cap (module’s 8675 divisor)', async () => {
    const boss = await loadBoss()
    // Small enough that only roll 1 is nonzero: chance = points / 867,500.
    const chance = uniqueChance(boss, ctxWith({ variant: 'normal', points: 8675 }))
    expect(chance).toBeCloseTo(0.01, 6)
  })

  it('caps a single roll at 65.7%, at exactly 570,000 points', async () => {
    const boss = await loadBoss()
    const chance = uniqueChance(boss, ctxWith({ variant: 'normal', points: 570_000 }))
    expect(chance).toBeCloseTo(570_000 / 867_500, 9)
    expect(chance).toBeCloseTo(0.657, 3)
  })

  it('matches the page’s own worked example: 855,000 points -> 65.7% then 32.85%', () => {
    const ctx = ctxWith({ variant: 'normal', points: 855_000 })
    // P(any unique) = 1 - (1-0.657)*(1-0.3285), not just the sum (they're independent).
    const expected = 1 - (1 - 570_000 / 867_500) * (1 - 285_000 / 867_500)
    expect(anyUniqueProbability(ctx)).toBeCloseTo(expected, 6)
    // And each roll's OWN chance individually matches the cited figures.
    const roll1 = defaultFormulaRegistry.get('cox_points')!({ kind: 'roll', rollIndex: 1 }, ctx)
    const roll2 = defaultFormulaRegistry.get('cox_points')!({ kind: 'roll', rollIndex: 2 }, ctx)
    expect(roll1).toBeCloseTo(0.657, 3)
    expect(roll2).toBeCloseTo(0.3285, 4)
  })

  it('keeps granting further rolls up to 6, letting the expected unique count exceed 1', async () => {
    const boss = await loadBoss()
    // 6 x 570,000 = 3,420,000 fully funds all six rolls at the 65.7% cap each,
    // so the raid can genuinely land more than one unique — "up to six unique
    // rewards can be obtained per raid" — and the expected COUNT (not
    // probability) reflects that.
    const ctx = ctxWith({ variant: 'normal', points: 3_420_000 })
    const expectedCount = 6 * (570_000 / 867_500)
    expect(uniqueChance(boss, ctx)).toBeCloseTo(expectedCount, 6)
    // P(at least one), by contrast, stays a real probability.
    expect(anyUniqueProbability(ctx)).toBeCloseTo(1 - (1 - 570_000 / 867_500) ** 6, 6)
    // More points beyond the 6-roll funding buys nothing further, for either measure.
    const overfundedCtx = ctxWith({ variant: 'normal', points: 10_000_000 })
    expect(uniqueChance(boss, overfundedCtx)).toBeCloseTo(expectedCount, 6)
    expect(anyUniqueProbability(overfundedCtx)).toBeCloseTo(anyUniqueProbability(ctx), 9)
  })

  it('splits Normal Mode’s roll in the post-patch 14/60 proportions, not the stale 20/69', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 400_000 })
    const dex = rateOf(boss, ctx, 'dexterous-prayer-scroll')
    const bow = rateOf(boss, ctx, 'twisted-bow')
    // Post-patch: 14/60 vs 2/60 = 7. Pre-patch would have been 20/69 vs 2/69 = 10.
    expect(dex / bow).toBeCloseTo(7, 6)
    expect(dex / bow).not.toBeCloseTo(10, 1)
  })

  it('reweights to the post-patch 12/56 in Challenge Mode', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'challenge', points: 400_000 })
    const dex = rateOf(boss, ctx, 'dexterous-prayer-scroll')
    const bow = rateOf(boss, ctx, 'twisted-bow')
    expect(dex / bow).toBeCloseTo(6, 6)
  })
})

describe('CoX: the common table is 33 slots, not a flat 43-item/denominator-99 table', () => {
  it('has exactly 33 entries summing to a denominator of 33', async () => {
    const boss = await loadBoss()
    const table = boss.tables.find((t) => t.id === 'cox:common')!
    expect(table.entries).toHaveLength(33)
    expect(table.denominator).toBe(33)
    expect(table.rolls).toBe(2)
    expect(table.withoutReplacement).toBe(true)
  })

  it('never drops a herb together with its own seed in the same raid', async () => {
    // The failure mode a flat 43-entry table would have: "without replacement"
    // over 43 rows would let roll 1 hit "ranarr herb" and roll 2 hit "ranarr
    // seed" from the SAME underlying slot — impossible under the real
    // mechanic ("the two rolls cannot end on the same drop"). Nesting the
    // herb/seed choice inside one weighted slot is what prevents it.
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 400_000 })
    const sim = simulate(boss, 30_000, ctx, 43)
    const pairs: [string, string][] = [
      ['grimy-ranarr-weed', 'ranarr-seed'],
      ['grimy-toadflax', 'toadflax-seed'],
      ['grimy-torstol', 'torstol-seed'],
    ]
    for (const [herb, seed] of pairs) {
      const both = sim.log.filter(
        (kill) => kill.drops.some((d) => d.itemKey === herb) && kill.drops.some((d) => d.itemKey === seed)
      )
      expect(both, `${herb} + ${seed} in the same raid`).toHaveLength(0)
    }
  })

  it('gives a herb’s seed the page’s own cited herbs-per-seed ratio (7 or 8)', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 100_000 })
    // Weight 2:1 means the herb fires ~2x as often as its seed — the 33%
    // seed-substitution rate the page states.
    const herbRate = rateOf(boss, ctx, 'grimy-ranarr-weed')
    const seedRate = rateOf(boss, ctx, 'ranarr-seed')
    expect(herbRate / seedRate).toBeCloseTo(2, 6)
  })
})

describe('CoX: common-table quantities are a deterministic function of points, not a random span', () => {
  it('is exactly floor(points / divisor) for a representative item, not a range roll', async () => {
    // Death rune's divisor is 36. At exactly 3,600 points every single drop of
    // it must carry quantity 100 — no variance at all, unlike a QtySpec.range
    // item (Theatre of Blood's own common table) which would show a spread.
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 3600, deaths: 0 })
    const sim = simulate(boss, 30_000, ctx, 47)
    const quantities = new Set(
      sim.log.flatMap((k) => k.drops.filter((d) => d.itemKey === 'death-rune').map((d) => d.qty))
    )
    expect([...quantities]).toEqual([100])
  })

  it('reproduces the wiki’s own published upper bound at the 131,071-point cap', async () => {
    // The page's displayed "1-3640" etc. ranges are the [~1, cap] SPAN of the
    // formula's output across realistic points totals, not an RNG range —
    // verified by checking the upper bound is exactly floor(131071/divisor)
    // for every item spot-checked here.
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 131_071 })
    const qtyOf = (itemKey: string): number => {
      const sim = simulate(boss, 4000, ctx, 53)
      const found = sim.log.flatMap((k) => k.drops.filter((d) => d.itemKey === itemKey))
      return found[0]?.qty ?? 0
    }
    expect(qtyOf('death-rune')).toBe(Math.floor(131_071 / 36))
    expect(qtyOf('runite-ore')).toBe(Math.floor(131_071 / 2000))
  })

  it('does not scale quantity past the 131,071 cap, even though the module’s own formula has none', async () => {
    // The module's trashItems loop applies no cap at all; the page's prose
    // ("Common-loot scaling caps at 131,071 points") does, and its own
    // published upper bounds confirm the cap is real. Using the module
    // literally here would have produced an uncapped, ever-growing quantity —
    // wrong in a way no structural check could catch.
    //
    // 500,000 points (comfortably over the 131,071 cap, but well under the
    // 570,000 full-roll funding point) keeps the common table reachable often
    // enough to sample reliably, unlike a multi-million-point context where a
    // unique hits on nearly every kill and the common table almost never
    // fires at all.
    const boss = await loadBoss()
    const capped = ctxWith({ variant: 'normal', points: 131_071 })
    const overCap = ctxWith({ variant: 'normal', points: 500_000 })
    const sim1 = simulate(boss, 8000, capped, 59)
    const sim2 = simulate(boss, 8000, overCap, 61)
    const qty = (sim: typeof sim1): number => {
      const found = sim.log.flatMap((k) => k.drops.filter((d) => d.itemKey === 'death-rune'))
      expect(found.length).toBeGreaterThan(0)
      return found[0]!.qty
    }
    expect(qty(sim1)).toBe(qty(sim2))
    expect(qty(sim1)).toBe(Math.floor(131_071 / 36))
  })

  it('holds Torn prayer scroll and Dark relic at exactly 1, whatever the points total', async () => {
    const boss = await loadBoss()
    for (const points of [0, 20_000, 500_000]) {
      const sim = simulate(boss, 4000, ctxWith({ variant: 'normal', points }), 67)
      for (const key of ['torn-prayer-scroll', 'dark-relic']) {
        const found = sim.log.flatMap((k) => k.drops.filter((d) => d.itemKey === key))
        for (const drop of found) expect(drop.qty, `${key} @ points=${points}`).toBe(1)
      }
    }
  })
})

describe('CoX: tertiary rewards use the conditioned marginal, not the bucket’s raw rate', () => {
  it('matches the page’s own cited example: ~1/1,765 Olmlet at 26,025 points', async () => {
    const boss = await loadBoss()
    const rate = rateOf(boss, ctxWith({ variant: 'normal', points: 26_025 }), 'olmlet')
    expect(rate).toBeCloseTo(1 / 1765, 3)
  })

  it('gives elite clue only the (1-P(unique)) share, close to but under the raw 1/12', async () => {
    const boss = await loadBoss()
    const rate = rateOf(boss, ctxWith({ variant: 'normal', points: 26_025 }), 'clue-scroll-elite')
    expect(rate).toBeLessThan(1 / 12)
    expect(rate).toBeCloseTo((1 - uniqueChance(boss, ctxWith({ variant: 'normal', points: 26_025 }))) / 12, 9)
  })

  it('using the RAW unconditioned 1/53 instead would overstate Olmlet by over 30x at typical points', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal', points: 26_025 })
    const modelled = rateOf(boss, ctx, 'olmlet')
    const naive = 1 / 53
    expect(naive / modelled).toBeGreaterThan(30)
  })

  it('rolls Dark journal and Ancient tablet only once per account, never again after being received', async () => {
    // The currently-generated (pre-override) document attaches NO ownership
    // gate to Dark journal at all, so it awards it on every single kill
    // unconditionally — a real bug, not merely an approximation. With the
    // gate, a fresh account gets it exactly once across a whole batch, ever.
    const boss = await loadBoss()
    const owned = ctxWith({
      variant: 'normal',
      points: 20_000,
      ownedCounts: { 'dark-journal': 1, 'ancient-tablet': 1 },
    })
    expect(rateOf(boss, owned, 'dark-journal')).toBe(0)
    expect(rateOf(boss, owned, 'ancient-tablet')).toBe(0)
    const fresh = simulate(boss, 500, ctxWith({ variant: 'normal', points: 20_000 }), 71)
    expect(fresh.drops.find((d) => d.itemKey === 'dark-journal')!.drops).toBe(1)
  })

  it('restricts Metamorphic dust to Challenge Mode', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ variant: 'normal', points: 20_000 }), 'metamorphic-dust')).toBe(0)
    expect(rateOf(boss, ctxWith({ variant: 'challenge', points: 20_000 }), 'metamorphic-dust')).toBeCloseTo(
      1 / 400,
      9
    )
  })
})

describe('CoX: the document still carries what the override authored', () => {
  /**
   * A guard that this suite did non-trivial work, per docs/HANDOFF.md landmine
   * #11f: every assertion above reads the real generated document, so if a
   * re-parse dropped the override the `rateOf`/`simulate` lookups would
   * quietly return 0 or fall back to the stale generated tables and several
   * tests would still pass by coincidence.
   */
  it('is merged from the override with all three hand-authored tables', async () => {
    const boss = await loadBoss()
    expect(boss.source).toBe('merged')
    expect(boss.tables.map((t) => t.id)).toEqual(['cox:unique-rolls', 'cox:common', 'cox:tertiary'])
    expect(boss.variants).toEqual(['normal', 'challenge'])
  })

  it('still fails not_on_watchlist — the point-scaled mechanic stays watchlisted', async () => {
    const boss = await loadBoss()
    expect(boss.status).toBe('needs_review')
    const watchlist = boss.validation.checks.find((c) => c.check === 'not_on_watchlist')!
    expect(watchlist.ok).toBe(false)
  })

  it('reaches every wiki drop row', async () => {
    const boss = await loadBoss()
    const covered = boss.validation.checks.find((c) => c.check === 'drops_covered')!
    expect(covered.ok).toBe(true)
  })
})
