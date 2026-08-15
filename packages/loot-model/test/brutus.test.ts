import { describe, expect, it } from 'vitest'
import { expectedValue, resolveSimContext, simulate, type SimContext } from '../src/index'
import {
  BRUTUS_AVERAGE_KILL_VALUE,
  BRUTUS_ITEM_IDS,
  CLUE_SCROLL_EASY_ITEM_ID,
  brutus,
  brutusPrices,
} from './fixtures/brutus'
import { dropCount } from './helpers'

const members: SimContext = resolveSimContext(brutus, { members: true })
const f2p: SimContext = resolveSimContext(brutus, { members: false })

const KILLS = 1_000_000
const SEED = 0x5eed

const mainTable = brutus.tables.find((table) => table.id === 'brutus:main')

function weightSum(isMembers: boolean): number {
  if (mainTable === undefined) throw new Error('brutus:main is missing from the fixture')
  return mainTable.entries
    .filter((entry) =>
      (entry.conditions ?? []).every(
        (condition) => condition.kind !== 'members' || condition.value === isMembers
      )
    )
    .reduce((sum, entry) => sum + (entry.rate.kind === 'weight' && typeof entry.rate.weight === 'number' ? entry.rate.weight : 0), 0)
}

describe('Brutus fixture (PROJECT_PLAN.md 6.4)', () => {
  it('reconciles to denominator 81 for each membership variant', () => {
    expect(weightSum(true)).toBe(81)
    expect(weightSum(false)).toBe(81)
  })

  it('sums to 106 when the variants are naively merged, as the plan warns', () => {
    if (mainTable === undefined) throw new Error('brutus:main is missing from the fixture')
    const naive = mainTable.entries.reduce(
      (sum, entry) => sum + (entry.rate.kind === 'weight' && typeof entry.rate.weight === 'number' ? entry.rate.weight : 0),
      0
    )
    expect(naive).toBe(106)
  })

  it('collapses seven wiki headings into four canonical tables', () => {
    expect(brutus.tables.map((table) => table.mode)).toEqual([
      'always',
      'preroll',
      'weighted',
      'independent',
    ])
  })
})

describe('Brutus expected value', () => {
  it('is analytically within 2% of the wiki average kill value', () => {
    const { gpPerKill } = expectedValue(brutus, members, { prices: brutusPrices })
    expect(gpPerKill).toBeGreaterThan(BRUTUS_AVERAGE_KILL_VALUE * 0.98)
    expect(gpPerKill).toBeLessThan(BRUTUS_AVERAGE_KILL_VALUE * 1.02)
  })

  it(`simulates ${KILLS.toLocaleString('en-US')} kills within 2% of it too`, () => {
    const result = simulate(brutus, KILLS, members, SEED, { prices: brutusPrices })
    expect(result.gpPerKill).toBeGreaterThan(BRUTUS_AVERAGE_KILL_VALUE * 0.98)
    expect(result.gpPerKill).toBeLessThan(BRUTUS_AVERAGE_KILL_VALUE * 1.02)
  })

  it('converges on the analytic figure', () => {
    const analytic = expectedValue(brutus, members, { prices: brutusPrices })
    const observed = simulate(brutus, KILLS, members, SEED, { prices: brutusPrices })
    // The bottomless milk bucket is 9000 gp at 4/150, which dominates the
    // variance: one standard error over a million kills is around 1.5 gp. A
    // relative band is the honest tolerance here — an absolute ±0.5 would fail
    // on sampling noise rather than on a defect.
    const relative = Math.abs(observed.gpPerKill - analytic.gpPerKill) / analytic.gpPerKill
    expect(relative).toBeLessThan(0.01)
  })

  it('is reproducible for a given seed', () => {
    const a = simulate(brutus, 50_000, members, SEED, { prices: brutusPrices })
    const b = simulate(brutus, 50_000, members, SEED, { prices: brutusPrices })
    expect(a.gpTotal).toBe(b.gpTotal)
    expect(a.drops).toEqual(b.drops)
  })
})

describe('Brutus members vs F2P', () => {
  const membersRun = simulate(brutus, 200_000, members, SEED, { prices: brutusPrices })
  const f2pRun = simulate(brutus, 200_000, f2p, SEED, { prices: brutusPrices })

  it('gives members the seed and noted-steak slots and F2P the coin slot', () => {
    for (const itemId of [
      BRUTUS_ITEM_IDS.potatoSeed,
      BRUTUS_ITEM_IDS.acorn,
      CLUE_SCROLL_EASY_ITEM_ID,
      BRUTUS_ITEM_IDS.beef,
    ]) {
      expect(dropCount(membersRun.drops, itemId)).toBeGreaterThan(0)
      expect(dropCount(f2pRun.drops, itemId)).toBe(0)
    }
    expect(dropCount(f2pRun.drops, BRUTUS_ITEM_IDS.coins)).toBeGreaterThan(0)
    expect(dropCount(membersRun.drops, BRUTUS_ITEM_IDS.coins)).toBe(0)
  })

  it('keeps the shared slots at the same rate in both variants', () => {
    // Both variants have denominator 81, so a weight-15 slot is 15/81 either way,
    // discounted only by the 1/150 preroll.
    const shared = [BRUTUS_ITEM_IDS.airRune, BRUTUS_ITEM_IDS.cowhide, BRUTUS_ITEM_IDS.logs]
    for (const itemId of shared) {
      const m = dropCount(membersRun.drops, itemId) / membersRun.kills
      const f = dropCount(f2pRun.drops, itemId) / f2pRun.kills
      expect(Math.abs(m - f)).toBeLessThan(0.005)
    }
  })

  it('produces individually correct rates against the analytic model', () => {
    for (const [run, ctx] of [
      [membersRun, members],
      [f2pRun, f2p],
    ] as const) {
      const analytic = expectedValue(brutus, ctx, { prices: brutusPrices })
      for (const item of analytic.items) {
        const observed = (run.drops.find((d) => d.itemId === item.itemId)?.drops ?? 0) / run.kills
        const slack = Math.max(0.05 * item.expectedDrops, 0.002)
        expect(Math.abs(observed - item.expectedDrops), item.name).toBeLessThan(slack)
      }
    }
  })

  it('yields different gp per kill for the two variants', () => {
    expect(membersRun.gpPerKill).not.toBeCloseTo(f2pRun.gpPerKill, 0)
    expect(membersRun.gpPerKill).toBeGreaterThan(f2pRun.gpPerKill)
  })
})

describe('Brutus preroll', () => {
  it('short-circuits the main table but never the tertiary or 100% tables', () => {
    const run = simulate(brutus, 200_000, members, SEED, { logLimit: 200_000 })
    const prerollItems = new Set<string>(['mooleta', 'bottomless-milk-bucket', 'cow-slippers'])
    const killsWithHorn = run.log.filter((kill) =>
      kill.drops.some((drop) => prerollItems.has(drop.itemKey))
    )
    expect(killsWithHorn.length).toBeGreaterThan(0)

    const mainItems = new Set<string>([
      'iron-full-helm',
      'iron-platebody',
      'iron-platelegs',
      'iron-plateskirt',
      'iron-arrow',
      'air-rune',
      'mind-rune',
      'chaos-rune',
      'potato-seed',
      'acorn',
      'cowhide',
      'oak-logs',
      'logs',
    ])
    for (const kill of killsWithHorn) {
      expect(kill.drops.some((drop) => mainItems.has(drop.itemKey))).toBe(false)
      // Bull bones are a 100% drop and survive the short-circuit.
      expect(kill.drops.some((drop) => drop.itemId === BRUTUS_ITEM_IDS.bullBones)).toBe(true)
    }
    // Tertiary drops still land on preroll kills across 200k samples.
    expect(
      killsWithHorn.some((kill) =>
        kill.drops.some((drop) => drop.itemId === BRUTUS_ITEM_IDS.clueScrollBeginner)
      )
    ).toBe(true)
  })
})
