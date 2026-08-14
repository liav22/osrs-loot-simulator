import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { loadSharedTables } from '../src/tables/shared-tables.js'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Lunar Chest (`data/overrides/lunar-chest.json` plus the
 * three `data/tables/lunar_chest_*_set.json` records).
 *
 * The page states three figures precisely, and two of them exist specifically
 * to correct wrong readings that a first-draft Jagex news post implied — so
 * they are exactly what this check has to reproduce:
 *
 *   1/56 per Moon killed, INDEPENDENT
 *   three Moons => 1 - (55/56)^3 ~= 1/19 overall, NOT 3/56, NOT a 4th roll
 *   standard loot rolls 1x / 3x / 6x for 1 / 2 / 3 Moons (3x per extra Moon)
 *   the piece given is uniform over that set's NOT-yet-obtained pieces
 *
 *      — Lunar Chest, ==Loot mechanics==, revid 15284737
 */

const UNIQUES = [
  'eclipse-atlatl', 'eclipse-moon-helm', 'eclipse-moon-chestplate', 'eclipse-moon-tassets',
  'dual-macuahuitl', 'blood-moon-helm', 'blood-moon-chestplate', 'blood-moon-tassets',
  'blue-moon-spear', 'blue-moon-helm', 'blue-moon-chestplate', 'blue-moon-tassets',
]
const ECLIPSE = UNIQUES.slice(0, 4)

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'bosses', 'lunar-chest.json'), 'utf8')
  )
  return BossSchema.parse(raw)
}

const ctxWith = (over: Partial<SimContext>): SimContext => ({
  ...DEFAULT_SIM_CONTEXT,
  members: true,
  ...over,
})

describe("Lunar Chest: the wiki's stated unique rates", () => {
  it('one Moon gives exactly 1/56 at that set, and nothing at the others', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const ev = expectedValue(boss, ctxWith({ moonsKilled: ['eclipse'] }), { tables })

    const eclipse = ev.items.filter((i) => ECLIPSE.includes(i.itemKey))
    const total = eclipse.reduce((s, i) => s + i.expectedDrops, 0)
    expect(total).toBeCloseTo(1 / 56, 12)
    // Uniform across the 4 unowned pieces: 1/56 x 1/4 each.
    for (const item of eclipse) expect(item.expectedDrops).toBeCloseTo(1 / 224, 12)

    // The other two sets cannot drop — their Moons were not killed.
    const others = ev.items.filter(
      (i) => UNIQUES.includes(i.itemKey) && !ECLIPSE.includes(i.itemKey)
    )
    for (const item of others) expect(item.expectedDrops, item.itemKey).toBe(0)
  })

  it('three Moons give 3 independent 1/56 triggers, one per set', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const ev = expectedValue(boss, ctxWith({ moonsKilled: ['blood', 'blue', 'eclipse'] }), {
      tables,
    })
    const total = ev.items
      .filter((i) => UNIQUES.includes(i.itemKey))
      .reduce((s, i) => s + i.expectedDrops, 0)
    // Expected COUNT is 3/56 by linearity; the wiki's "not 3/56" disclaimer is
    // about the CHANCE of at least one, which is lower because two triggers
    // can hit in the same opening. Both are asserted — count here, chance
    // below — because conflating them is the error the disclaimer warns about.
    expect(total).toBeCloseTo(3 / 56, 12)
    for (const set of [ECLIPSE, UNIQUES.slice(4, 8), UNIQUES.slice(8, 12)]) {
      const perSet = ev.items
        .filter((i) => set.includes(i.itemKey))
        .reduce((s, i) => s + i.expectedDrops, 0)
      expect(perSet).toBeCloseTo(1 / 56, 12)
    }
  })

  it("P(any unique in a FRESH opening) is ~1/19, not 3/56", async () => {
    // Measured over first openings only. It cannot be measured as a long-run
    // average, because ownership is lifetime-scoped: a single long run
    // collects all 12 pieces early and every later opening yields nothing.
    // That is the mechanic working, not a defect — see the collection test.
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const ctx = ctxWith({ moonsKilled: ['blood', 'blue', 'eclipse'] })
    const runs = 20_000
    let withUnique = 0
    for (let seed = 1; seed <= runs; seed++) {
      const result = simulate(boss, 1, ctx, seed, { tables, logLimit: 1 })
      if (result.log[0]?.drops.some((d) => UNIQUES.includes(d.itemKey))) withUnique += 1
    }
    const observed = withUnique / runs
    const expected = 1 - (55 / 56) ** 3 // ~0.0527, i.e. ~1/19
    expect(observed / expected).toBeGreaterThan(0.9)
    expect(observed / expected).toBeLessThan(1.1)
  })

  it('lifetime duplicate protection: every piece drops exactly once, ever', async () => {
    // The sharpest statement of the whole mechanic. Over a long run a player
    // collects each of the 12 uniques and then can never receive it again,
    // because its ownershipGate ('below 1') removes it from its set's pool.
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const result = simulate(boss, 100_000, ctxWith({ moonsKilled: ['blood', 'blue', 'eclipse'] }), 29, {
      tables,
    })
    for (const key of UNIQUES) {
      const drops = result.drops.find((d) => d.itemKey === key)?.drops ?? 0
      expect(drops, `${key} should drop exactly once over a lifetime`).toBe(1)
    }
  })

  it('duplicate protection: owned pieces leave the pool and the rest stay uniform', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const owned = { 'eclipse-atlatl': 1, 'eclipse-moon-helm': 1 }
    const ev = expectedValue(boss, ctxWith({ moonsKilled: ['eclipse'], ownedCounts: owned }), {
      tables,
    })

    const rate = (key: string): number =>
      ev.items.find((i) => i.itemKey === key)?.expectedDrops ?? 0
    // Owned pieces: gone.
    expect(rate('eclipse-atlatl')).toBe(0)
    expect(rate('eclipse-moon-helm')).toBe(0)
    // The two remaining split the SAME 1/56 evenly — the trigger rate does not
    // shrink with the pool, which is what "uniform over pieces not obtained"
    // means and is why the set is a sub-table rather than 4 flat 1/224 rows.
    expect(rate('eclipse-moon-chestplate')).toBeCloseTo(1 / 112, 12)
    expect(rate('eclipse-moon-tassets')).toBeCloseTo(1 / 112, 12)
    expect(rate('eclipse-moon-chestplate') + rate('eclipse-moon-tassets')).toBeCloseTo(1 / 56, 12)
  })

  it('a completed set yields nothing rather than NaN or a phantom drop', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const owned = Object.fromEntries(ECLIPSE.map((k) => [k, 1]))
    const ev = expectedValue(boss, ctxWith({ moonsKilled: ['eclipse'], ownedCounts: owned }), {
      tables,
    })
    for (const key of ECLIPSE) {
      expect(ev.items.find((i) => i.itemKey === key)?.expectedDrops ?? 0).toBe(0)
    }
    expect(Number.isFinite(ev.gpPerKill)).toBe(true)
  })
})

describe('Lunar Chest: standard loot', () => {
  it('rolls 1x / 3x / 6x for one / two / three Moons — 3x per extra Moon, not additive', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const standardTotal = (moons: SimContext['moonsKilled']): number =>
      expectedValue(boss, ctxWith({ moonsKilled: moons }), { tables })
        .items.filter((i) => !UNIQUES.includes(i.itemKey))
        .reduce((s, i) => s + i.expectedDrops, 0)

    const one = standardTotal(['blood'])
    const two = standardTotal(['blood', 'blue'])
    const three = standardTotal(['blood', 'blue', 'eclipse'])

    // Ratios, not absolutes: the unique suppression scales all three by a
    // slightly different surviving-chain factor, so compare shape.
    expect(two / one).toBeGreaterThan(2.9)
    expect(two / one).toBeLessThan(3.0)
    expect(three / one).toBeGreaterThan(5.7)
    expect(three / one).toBeLessThan(6.0)
    // Explicitly not the additive reading (3 Moons would be 3x, not ~6x).
    expect(three / one).toBeGreaterThan(4)
  })

  it('is suppressed entirely whenever a unique hits', async () => {
    const [boss, tables] = [await loadBoss(), await loadSharedTables()]
    const n = 200_000
    const result = simulate(boss, n, ctxWith({ moonsKilled: ['blood', 'blue', 'eclipse'] }), 23, {
      tables,
      logLimit: n,
    })
    const contradictions = result.log.filter(
      (k) =>
        k.drops.some((d) => UNIQUES.includes(d.itemKey)) &&
        k.drops.some((d) => !UNIQUES.includes(d.itemKey))
    )
    expect(contradictions).toEqual([])
  })
})

describe('Lunar Chest: document status', () => {
  it('is off the mechanics watchlist and reaches manual_override', async () => {
    const watchlist = JSON.parse(
      await readFile(join(REPO_ROOT, 'data', 'mechanics-watchlist.json'), 'utf8')
    ) as { entries: { lootSourceId: string }[] }
    expect(watchlist.entries.map((e) => e.lootSourceId)).not.toContain('lunar-chest')

    const boss = await loadBoss()
    expect(boss.status).toBe('manual_override')
  })
})
