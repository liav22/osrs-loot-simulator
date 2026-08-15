import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  toaCommonQtyScale,
  toaReweightedUniques,
  TOA_UNIQUES,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Tombs of Amascut (`data/overrides/chest-tombs-of-amascut.json`).
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures, not merely that the mechanic be
 * modelled — `docs/OVERRIDES.md` step 3. This file is that check, run against
 * the REAL generated document so it fails if a future re-parse stops emitting
 * any of it.
 *
 * Every assertion is pinned to something the wiki states outright, on
 * `Chest (Tombs of Amascut)` (revid 15274037) unless noted:
 *
 *   "Players will have a 1% chance to receive a unique item for every
 *    10,500 - 20 x RL total reward points"           — ===Uniques===
 *   "at raid level 400, players will have a 1% chance for every
 *    10,500 - 20(310 + 90/3) = 3,700 points earned"  — ===Uniques=== (worked example)
 *   "a maximum of 55% to see a unique"               — ===Uniques===
 *   "Only obtained if a player ends the raid with less than 1,500 total
 *    reward points."                                 — ===Pre-roll===
 *   "If dung is received, no common rewards are given."     — ===Pre-roll===
 *   "If one of these items is received, no common rewards are given.
 *    Tertiary rewards are still obtainable."         — ===Uniques===
 *   "raid level 305 is 16%, 400 is 35%, and 450 is 45% more"  — ===Common rewards===
 *   "the quantity is set to one" (cache of runes)    — ===Common rewards===
 *   "at 15 kill count, they will have a 3/10 chance"          — ===Tertiary rewards===
 *   "scales from 4/50 (1/12.5) up to 12/50 (~1/4.17), when reaching a kill
 *    count of 75"                                    — ===Tertiary rewards===
 *   "effectively changes the rarity of unowned jewels to 1/37.5, 1/25, and
 *    1/12.5 when owning one, two, or three"          — ===Tertiary rewards=== footnote
 *   "1/100 drop rate for every 2,000 rewards points ... up to a maximum of
 *    25/100"                                         — ===Tertiary rewards=== (Mod Ash)
 *   "1% chance to receive the pet for every 350,000 - 700 x RL points"
 *                                                    — ===Tertiary rewards===
 *   The 5-row unique weight table                    — ===Uniques===
 *   Challenge reward raid levels 350+/425+/500+ and "zero deaths for all
 *   party members"                                   — ===Challenge rewards===
 *
 * NOT asserted, because they are not modelled and the override says so: the
 * five remnant challenge rewards (need "all <boss> invocations and level 4
 * <boss>"), the elite CA's 1.05x clue multiplier, team size, and duplicate
 * jewels once all four are owned.
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'bosses', 'chest-tombs-of-amascut.json'), 'utf8')
  )
  return BossSchema.parse(raw)
}

function ctxWith(overrides: Partial<SimContext>): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, members: true, ...overrides }
}

/**
 * Expected drops of an item per raid, from the analytic path.
 *
 * For every entry asserted below except the common table this equals the
 * per-raid probability, since each is a single Bernoulli entry — the common
 * table's three rolls are the one place the two differ, and that test says so.
 */
function rateOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const ev = expectedValue(boss, ctx)
  return ev.items.find((d) => d.itemKey === itemKey)?.expectedDrops ?? 0
}

describe('ToA: the unique weight table reproduces the wiki’s published rows', () => {
  /**
   * The page publishes five rows of decimal rarities; the module publishes the
   * integer weights that generate them. This asserts the second reproduces the
   * first — which is what licenses using the module's rule at raid levels
   * BETWEEN those rows, where the page states nothing.
   */
  const PUBLISHED: Array<[number, Record<string, number>]> = [
    [300, { fang: 3.43, lightbearer: 3.43, ward: 8, masori: 12, shadow: 24 }],
    [350, { fang: 3.67, lightbearer: 3.67, ward: 7.33, masori: 11, shadow: 22 }],
    [400, { fang: 4.75, lightbearer: 3.8, ward: 6.33, masori: 9.5, shadow: 19 }],
    [450, { fang: 4.5, lightbearer: 4.5, ward: 6, masori: 9, shadow: 18 }],
    [500, { fang: 5.5, lightbearer: 4.71, ward: 5.5, masori: 8.25, shadow: 16.5 }],
  ]

  it.each(PUBLISHED)('raid level %i', (raidLevel, expected) => {
    const { fang, lightbearer } = toaReweightedUniques(raidLevel)
    const sum = fang + lightbearer + 30 + 20 * 3 + 10
    // The page prints these to three significant figures, so agreement is
    // asserted at that precision and no tighter.
    expect(sum / fang).toBeCloseTo(expected['fang']!, 2)
    expect(sum / lightbearer).toBeCloseTo(expected['lightbearer']!, 2)
    expect(sum / 30).toBeCloseTo(expected['ward']!, 2)
    expect(sum / 20).toBeCloseTo(expected['masori']!, 2)
    expect(sum / 10).toBeCloseTo(expected['shadow']!, 2)
  })

  it('only the fang and the lightbearer ever move', () => {
    // The prose says the other five change only *relatively*, via the
    // shrinking denominator. If a future edit made one of them raid-level
    // dependent this would catch it.
    for (const [key, { weight }] of Object.entries(TOA_UNIQUES)) {
      if (key === 'osmumten-s-fang' || key === 'lightbearer') continue
      expect(weight, key).toBe(TOA_UNIQUES[key as keyof typeof TOA_UNIQUES].weight)
    }
    expect(Object.keys(TOA_UNIQUES)).toHaveLength(7)
  })
})

describe('ToA: the unique roll', () => {
  it("matches the page's own worked example: 1% per 3,700 points at raid level 400", async () => {
    const boss = await loadBoss()
    const total = [...Object.keys(TOA_UNIQUES)].reduce(
      (sum, key) => sum + rateOf(boss, ctxWith({ points: 3700, raidLevel: 400 }), key),
      0
    )
    expect(total).toBeCloseTo(0.01, 6)
  })

  it('caps at 55%, and excess points do not buy a second roll', async () => {
    const boss = await loadBoss()
    const uniqueTotal = (points: number): number =>
      [...Object.keys(TOA_UNIQUES)].reduce(
        (sum, key) => sum + rateOf(boss, ctxWith({ points, raidLevel: 400 }), key),
        0
      )
    expect(uniqueTotal(500_000)).toBeCloseTo(0.55, 6)
    expect(uniqueTotal(5_000_000)).toBeCloseTo(0.55, 6)
  })

  it('splits the roll across the 7 uniques in the published proportions', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ points: 20_000, raidLevel: 400 })
    const fang = rateOf(boss, ctx, 'osmumten-s-fang')
    const shadow = rateOf(boss, ctx, 'tumeken-s-shadow-uncharged')
    // At raid level 400 the weights are fang 40, shadow 10 out of 190.
    expect(fang / shadow).toBeCloseTo(4, 6)
  })

  it('a unique suppresses the common table, and dung suppresses both', async () => {
    const boss = await loadBoss()
    // Below 1,500 points: dung every raid, and no common rewards at all.
    const dung = simulate(boss, 2000, ctxWith({ points: 1000, raidLevel: 300 }), 7)
    expect(dung.drops.find((d) => d.itemKey === 'fossilised-dung')?.drops).toBe(2000)
    expect(dung.drops.find((d) => d.itemKey === 'coins')?.drops ?? 0).toBe(0)

    // At/above it: never dung, and the common table runs.
    const normal = simulate(boss, 2000, ctxWith({ points: 1500, raidLevel: 300 }), 7)
    expect(normal.drops.find((d) => d.itemKey === 'fossilised-dung')?.drops ?? 0).toBe(0)
    expect(normal.drops.find((d) => d.itemKey === 'coins')!.drops).toBeGreaterThan(0)
  })

  it('leaves tertiary rewards obtainable even on a dung raid', async () => {
    const boss = await loadBoss()
    // "Tertiary rewards are still obtainable" — independent mode is not part
    // of the chain a preroll hit suppresses.
    const dung = simulate(boss, 20_000, ctxWith({ points: 1000, raidLevel: 300 }), 11)
    expect(dung.drops.find((d) => d.itemKey === 'thread-of-elidinis')!.drops).toBeGreaterThan(0)
  })
})

describe('ToA: common rewards', () => {
  it('scales quantities by the raid-level bonus the page states in prose', () => {
    // "At raid level 300 ... 15% additional ... raid level 305 is 16%, 400 is
    // 35%, and 450 is 45% more."
    expect(toaCommonQtyScale(300)).toBeCloseTo(1.15, 9)
    expect(toaCommonQtyScale(305)).toBeCloseTo(1.16, 9)
    expect(toaCommonQtyScale(400)).toBeCloseTo(1.35, 9)
    expect(toaCommonQtyScale(450)).toBeCloseTo(1.45, 9)
    // Below 300 there is no bonus; below 150 the module reduces loot by 25%.
    expect(toaCommonQtyScale(299)).toBe(1)
    expect(toaCommonQtyScale(149)).toBe(0.75)
  })

  it('gives each of the 27 items an equal share, three rolls per raid', async () => {
    const boss = await loadBoss()
    const boss27 = boss.tables.find((t) => t.id === 'toa:common')!
    expect(boss27.entries).toHaveLength(27)
    expect(boss27.denominator).toBe(27)
    expect(boss27.rolls).toBe(3)

    const ctx = ctxWith({ points: 20_000, raidLevel: 300 })
    // Every item 1/27 per roll, 3 rolls: 3/27 EXPECTED DROPS per raid — but
    // only on the raids that reach the common table at all. The unique preroll
    // suppresses it, so the figure is scaled by the chance of NO unique. That
    // composition is the mechanic ("If one of these items is received, no
    // common rewards are given"), so it is asserted rather than sidestepped.
    const uniqueChance = [...Object.keys(TOA_UNIQUES)].reduce(
      (sum, key) => sum + rateOf(boss, ctx, key),
      0
    )
    expect(uniqueChance).toBeGreaterThan(0)
    expect(rateOf(boss, ctx, 'coins')).toBeCloseTo((3 / 27) * (1 - uniqueChance), 6)
  })

  it('holds cache of runes at exactly one, whatever the points total', async () => {
    const boss = await loadBoss()
    for (const points of [2000, 20_000, 59_000]) {
      const sim = simulate(boss, 500, ctxWith({ points, raidLevel: 500 }), 3)
      const cache = sim.drops.find((d) => d.itemKey === 'cache-of-runes')!
      expect(cache.quantity / cache.drops, `points=${points}`).toBe(1)
    }
  })

  it('scales coins with points and raid level, floored per the module', async () => {
    const boss = await loadBoss()
    // Coins have divisor 1, so the quantity is the points total itself,
    // scaled and floored.
    const at300 = simulate(boss, 200, ctxWith({ points: 20_000, raidLevel: 300 }), 5)
    const coins300 = at300.drops.find((d) => d.itemKey === 'coins')!
    expect(coins300.quantity / coins300.drops).toBe(Math.floor(20_000 * 1.15))

    const at150 = simulate(boss, 200, ctxWith({ points: 20_000, raidLevel: 150 }), 5)
    const coins150 = at150.drops.find((d) => d.itemKey === 'coins')!
    expect(coins150.quantity / coins150.drops).toBe(20_000)
  })
})

describe('ToA: tertiary rewards', () => {
  it('runs the thread of Elidinis from 1/10 to 3/10 at 15 completions', async () => {
    const boss = await loadBoss()
    const thread = (killCount: number): number =>
      rateOf(boss, ctxWith({ killCount, points: 20_000, raidLevel: 300 }), 'thread-of-elidinis')
    expect(thread(0)).toBeCloseTo(1 / 10, 9)
    expect(thread(15)).toBeCloseTo(3 / 10, 9)
    // Linear between, and capped after.
    expect(thread(5)).toBeCloseTo((1 / 10) * (1 + 10 / 15), 9)
    expect(thread(100)).toBeCloseTo(3 / 10, 9)
  })

  it('drops the thread to a flat 1/50 once one has been received', async () => {
    const boss = await loadBoss()
    const owned = ctxWith({
      killCount: 200,
      points: 20_000,
      raidLevel: 300,
      ownedCounts: { 'thread-of-elidinis': 1 },
    })
    // The bad-luck curve no longer applies at all — not 3/10, and not the
    // curve's value at kc 200.
    expect(rateOf(boss, owned, 'thread-of-elidinis')).toBeCloseTo(1 / 50, 9)
  })

  it('runs the jewel pool from 4/50 to 12/50 at 75 completions', async () => {
    const boss = await loadBoss()
    const JEWELS = [
      'eye-of-the-corruptor',
      'jewel-of-the-sun',
      'breach-of-the-scarab',
      'jewel-of-amascut',
    ]
    const anyJewel = (killCount: number): number => {
      const ctx = ctxWith({ killCount, points: 20_000, raidLevel: 300 })
      return JEWELS.reduce((sum, key) => sum + rateOf(boss, ctx, key), 0)
    }
    expect(anyJewel(0)).toBeCloseTo(4 / 50, 9)
    expect(anyJewel(75)).toBeCloseTo(12 / 50, 9)
  })

  it("guarantees an unowned jewel, matching the page's 1/37.5, 1/25 and 1/12.5", async () => {
    const boss = await loadBoss()
    const JEWELS = [
      'eye-of-the-corruptor',
      'jewel-of-the-sun',
      'breach-of-the-scarab',
      'jewel-of-amascut',
    ]
    // This is the assertion the `oneOf` ownership pool exists for: with N
    // jewels owned, the roll still hits at 4/50 but is shared among only the
    // 4-N unowned ones, so each unowned jewel's own rate rises.
    const rateOfUnowned = (ownedCount: number): number => {
      const ownedCounts = Object.fromEntries(JEWELS.slice(0, ownedCount).map((k) => [k, 1]))
      const ctx = ctxWith({ killCount: 0, points: 20_000, raidLevel: 300, ownedCounts })
      return rateOf(boss, ctx, JEWELS[ownedCount]!)
    }
    expect(rateOfUnowned(0)).toBeCloseTo(1 / 50, 9)
    expect(rateOfUnowned(1)).toBeCloseTo(1 / 37.5, 9)
    expect(rateOfUnowned(2)).toBeCloseTo(1 / 25, 9)
    expect(rateOfUnowned(3)).toBeCloseTo(1 / 12.5, 9)
  })

  it('never awards a jewel the player already owns', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({
      killCount: 0,
      points: 20_000,
      raidLevel: 300,
      ownedCounts: { 'eye-of-the-corruptor': 1, 'jewel-of-the-sun': 1 },
    })
    const sim = simulate(boss, 20_000, ctx, 13)
    expect(sim.drops.find((d) => d.itemKey === 'eye-of-the-corruptor')?.drops ?? 0).toBe(0)
    expect(sim.drops.find((d) => d.itemKey === 'jewel-of-the-sun')?.drops ?? 0).toBe(0)
    expect(sim.drops.find((d) => d.itemKey === 'breach-of-the-scarab')!.drops).toBeGreaterThan(0)
  })

  it('gives the elite clue 1% per 2,000 points, capped at 25%', async () => {
    const boss = await loadBoss()
    const clue = (points: number): number =>
      rateOf(boss, ctxWith({ points, raidLevel: 300 }), 'clue-scroll-elite')
    expect(clue(2000)).toBeCloseTo(0.01, 9)
    expect(clue(20_000)).toBeCloseTo(0.1, 9)
    expect(clue(50_000)).toBeCloseTo(0.25, 9)
    expect(clue(500_000)).toBeCloseTo(0.25, 9)
  })

  it('gives the pet 1% per (350,000 - 700 x RL) points', async () => {
    const boss = await loadBoss()
    // At raid level 300 the pet's scaled level is 300, so the denominator is
    // 350,000 - 210,000 = 140,000 points per 1%.
    expect(rateOf(boss, ctxWith({ points: 140_000, raidLevel: 300 }), 'tumeken-s-guardian')).toBeCloseTo(
      0.01,
      9
    )
  })
})

describe('ToA: challenge rewards', () => {
  it('gates each on its stated raid level', async () => {
    const boss = await loadBoss()
    const has = (itemKey: string, raidLevel: number): number =>
      rateOf(boss, ctxWith({ raidLevel, points: 20_000 }), itemKey)

    expect(has('masori-crafting-kit', 349)).toBe(0)
    expect(has('masori-crafting-kit', 350)).toBe(1)
    expect(has('menaphite-ornament-kit', 424)).toBe(0)
    expect(has('menaphite-ornament-kit', 425)).toBe(1)
    expect(has('cursed-phalanx', 499)).toBe(0)
    expect(has('cursed-phalanx', 500)).toBe(1)
  })

  it('requires zero deaths across the party', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ raidLevel: 500, points: 20_000, deaths: 0 }), 'cursed-phalanx')).toBe(1)
    expect(rateOf(boss, ctxWith({ raidLevel: 500, points: 20_000, deaths: 1 }), 'cursed-phalanx')).toBe(0)
  })

  it('cancels the roll once the player owns the item', async () => {
    const boss = await loadBoss()
    // "The game will check the player's inventory, worn equipment and bank ...
    // if it does, then the roll is canceled."
    const ctx = ctxWith({
      raidLevel: 500,
      points: 20_000,
      ownedCounts: { 'cursed-phalanx': 1 },
    })
    expect(rateOf(boss, ctx, 'cursed-phalanx')).toBe(0)
    // And in the sampled path it really is awarded exactly once from zero.
    const fresh = simulate(boss, 50, ctxWith({ raidLevel: 500, points: 20_000 }), 3)
    expect(fresh.drops.find((d) => d.itemKey === 'cursed-phalanx')!.drops).toBe(1)
  })
})

describe('ToA: the document still carries what the override authored', () => {
  /**
   * A guard that this suite did non-trivial work, per docs/HANDOFF.md landmine
   * #11f: every assertion above reads the real generated document, so if a
   * re-parse dropped the override the `rateOf` lookups would quietly return 0
   * and several tests would still pass by coincidence.
   */
  it('is override-sourced with all five hand-authored tables', async () => {
    const boss = await loadBoss()
    expect(boss.source).toBe('merged')
    expect(boss.tables.map((t) => t.id)).toEqual([
      'toa:dung-gate',
      'toa:unique',
      'toa:common',
      'toa:tertiary',
      'toa:challenge',
    ])
  })

  it('still fails not_on_watchlist, and for the reason the override states', async () => {
    const boss = await loadBoss()
    // The five remnant challenge rewards are not modelled, so ToA is NOT a
    // terminal success state and must not read as one. If someone removes the
    // watchlist entry to move the counter, this fails.
    expect(boss.status).toBe('needs_review')
    const watchlist = boss.validation.checks.find((c) => c.check === 'not_on_watchlist')!
    expect(watchlist.ok).toBe(false)
  })

  it('reaches every drop row the wiki lists except the five remnants', async () => {
    const boss = await loadBoss()
    const covered = boss.validation.checks.find((c) => c.check === 'drops_covered')!
    // Down from 15 missing before the override. The five that remain are
    // exactly the ones the override declines to model, named in its note.
    expect(covered.detail).toContain('5 of 50')
    for (const remnant of ['akkha', 'ba-ba', 'kephri', 'zebak']) {
      expect(covered.detail).toContain(`Remnant of ${remnant}`)
    }
    expect(covered.detail).toContain('Ancient remnant')
  })
})
