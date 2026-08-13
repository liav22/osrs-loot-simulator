import { describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, simulate, type Table } from '../src/index'
import { ctxWith, dropCount, dropQuantity, makeBoss } from './helpers'

/**
 * `TableRefNode.drawsPerHit` — Corporeal Beast's access-once-draw-K, the one
 * confirmed exception to `Table.rolls`' "N independent access attempts"
 * meaning. Its own template call states the mechanic verbatim: "a 12/512
 * chance of rolling the gem drop table, whereupon its contents are rolled 10
 * times."
 *
 * **The distinction is in the distribution, not the mean.** Both readings —
 * one 12/512 check gating 10 draws, and 10 independent 12/512 checks each
 * gating one draw — have the SAME per-kill expectation, because expectation
 * is linear (`10p x E[draw]` either way). An EV-only test therefore cannot
 * tell them apart, and one that appeared to would be testing something else.
 * What actually differs is how the yield clusters:
 *
 *   P(kill yields any gem loot)   12/512 = 2.34%   vs   1-(1-12/512)^10 = 21.1%
 *   draws | the kill yielded      exactly 10        vs   ~1.1
 *
 * The simulate tests below assert exactly that, which is the claim the wiki
 * text makes and the reason the default reading is wrong for this source.
 */

const GEM_A = 100
const GEM_B = 101
const ACCESS = { kind: 'fixed', num: 12, den: 512 } as const

function item(itemId: number, itemKey: string, n = 1) {
  return { kind: 'item', itemId, itemKey, name: itemKey, qty: { kind: 'exact', n } } as const
}

/**
 * Two entries at weight 1 against denominator 2 — no `nothing` remainder, so
 * every draw yields exactly one item. That makes "how many kills produced any
 * loot" a clean read on how many times the table was ACCESSED, which is the
 * thing the two readings actually disagree about; a remainder would dilute it
 * with a second, unrelated coin flip.
 */
const gemTable: Table = {
  id: 'gem_drop_table',
  mode: 'weighted',
  rolls: 1,
  withoutReplacement: false,
  denominator: 2,
  entries: [
    { node: item(GEM_A, 'gem-a'), rate: { kind: 'weight', weight: 1 } },
    { node: item(GEM_B, 'gem-b'), rate: { kind: 'weight', weight: 1 } },
  ],
}

const tables = new Map([['gem_drop_table', gemTable]])
const ctx = ctxWith()

/** Corporeal Beast's real shape: one access check, K guaranteed draws. */
function drawsPerHitBoss(drawsPerHit: number) {
  return makeBoss([
    {
      id: 'corp:gem-access',
      mode: 'independent',
      entries: [{ node: { kind: 'tableRef', ref: 'gem_drop_table', drawsPerHit }, rate: ACCESS }],
    },
  ])
}

/** The default (wrong-for-this-source) reading: K independent access checks. */
function rollsBoss(rolls: number) {
  return makeBoss([
    {
      id: 'corp:gem-access',
      mode: 'independent',
      rolls,
      entries: [{ node: { kind: 'tableRef', ref: 'gem_drop_table' }, rate: ACCESS }],
    },
  ])
}

function expectedDrops(result: ReturnType<typeof expectedValue>, itemId: number): number {
  return result.items.find((i) => i.itemId === itemId)?.expectedDrops ?? 0
}

describe('drawsPerHit: analytic expectation', () => {
  it("is linear in the draw count: access x K x the table's own share", () => {
    const result = expectedValue(drawsPerHitBoss(10), ctx, { tables })
    // (12/512) x 10 x (1/2) = 0.1171875, exactly.
    expect(expectedDrops(result, GEM_A)).toBeCloseTo((12 / 512) * 10 * 0.5, 12)
    expect(expectedDrops(result, GEM_B)).toBeCloseTo((12 / 512) * 10 * 0.5, 12)
  })

  it('matches the rolls-based reading exactly — documenting that means cannot distinguish them', () => {
    const draws = expectedValue(drawsPerHitBoss(10), ctx, { tables })
    const rolls = expectedValue(rollsBoss(10), ctx, { tables })
    // Not a coincidence and not a bug: expectation is linear, so this equality
    // is a fact about the model. It is why the simulate tests below check the
    // distribution instead — and why `ev_matches`-style mean checks could
    // never have caught the wrong reading for Corporeal Beast.
    expect(expectedDrops(draws, GEM_A)).toBeCloseTo(expectedDrops(rolls, GEM_A), 12)
  })

  it('absent means 1 — byte-identical to a document that never mentions it', () => {
    const withField = expectedValue(drawsPerHitBoss(1), ctx, { tables })
    const without = expectedValue(rollsBoss(1), ctx, { tables })
    expect(expectedDrops(withField, GEM_A)).toBeCloseTo(expectedDrops(without, GEM_A), 12)
    expect(expectedDrops(withField, GEM_A)).toBeCloseTo((12 / 512) * 0.5, 12)
  })
})

describe('drawsPerHit: simulate — the distribution, which is where the readings differ', () => {
  const n = 200_000

  it('gem loot arrives on 12/512 of kills, in batches of exactly 10 draws', () => {
    const result = simulate(drawsPerHitBoss(10), n, ctx, 21, { tables, logLimit: n })

    const yieldingKills = result.log.filter((kill) => kill.drops.length > 0)
    // One access check per kill => 12/512 = 2.34% of kills yield anything.
    // Asserted as a relative band, not `toBeCloseTo(_, 3)`: at this rate the
    // standard error over 200k kills is ~3.4e-4, so an absolute 5e-4 tolerance
    // is ~1.5 sigma and fails on ordinary sampling noise. 5% relative is ~3.5
    // sigma — wide enough to be stable, far too tight to pass on the rolls
    // reading (which lands 9x higher).
    const observed = yieldingKills.length / n
    expect(observed / (12 / 512)).toBeGreaterThan(0.95)
    expect(observed / (12 / 512)).toBeLessThan(1.05)

    // ...and every one of them drew the full batch. This is the assertion the
    // whole field exists for: a kill either misses entirely or yields ten
    // draws, never one.
    expect(yieldingKills.every((kill) => kill.drops.length === 10)).toBe(true)
  })

  it('the rolls-based reading spreads the same mean over ~9x as many kills', () => {
    const draws = simulate(drawsPerHitBoss(10), n, ctx, 21, { tables, logLimit: n })
    const rolls = simulate(rollsBoss(10), n, ctx, 21, { tables, logLimit: n })

    const yielding = (r: typeof draws): number => r.log.filter((k) => k.drops.length > 0).length
    // 1-(1-12/512)^10 = 21.1% vs 2.34% — the order-of-magnitude difference the
    // Corporeal Beast research doc describes.
    expect(yielding(rolls) / n).toBeCloseTo(1 - (1 - 12 / 512) ** 10, 2)
    expect(yielding(rolls)).toBeGreaterThan(yielding(draws) * 6)
    // The rolls reading almost never produces a full batch of 10.
    expect(rolls.log.filter((k) => k.drops.length === 10).length).toBeLessThan(
      draws.log.filter((k) => k.drops.length === 10).length / 100
    )

    // ...while the totals they produce agree, as the analytic path predicted.
    const total = (r: typeof draws): number => dropCount(r.drops, GEM_A) + dropCount(r.drops, GEM_B)
    expect(total(draws) / total(rolls)).toBeGreaterThan(0.95)
    expect(total(draws) / total(rolls)).toBeLessThan(1.05)
  })

  it('observed rate matches the analytic path', () => {
    const result = simulate(drawsPerHitBoss(10), 400_000, ctx, 33, { tables })
    const analytic = expectedDrops(expectedValue(drawsPerHitBoss(10), ctx, { tables }), GEM_A)
    expect(dropCount(result.drops, GEM_A) / 400_000).toBeCloseTo(analytic, 2)
  })
})

describe('drawsPerHit: composes with qtyMultiplier without conflating with it', () => {
  // The two are orthogonal: `drawsPerHit` changes how many separate yields
  // happen, `qtyMultiplier` changes how big each one is. Conflating them would
  // corrupt `drops[]` (times an item came up) against `quantity`.
  const boss = makeBoss([
    {
      id: 'corp:gem-access',
      mode: 'independent',
      entries: [
        {
          node: { kind: 'tableRef', ref: 'gem_drop_table', drawsPerHit: 4, qtyMultiplier: 3 },
          rate: { kind: 'always' },
        },
      ],
    },
  ])

  it('drops scale with draws, quantity scales with both', () => {
    const n = 20_000
    const result = simulate(boss, n, ctx, 44, { tables })
    const drops = dropCount(result.drops, GEM_A)
    const quantity = dropQuantity(result.drops, GEM_A)

    // 4 draws x 1/2 share = 2 expected drops per kill, each of 1 unit x3.
    expect(drops / n).toBeCloseTo(2, 1)
    expect(quantity / drops).toBeCloseTo(3, 12)

    const analytic = expectedValue(boss, ctx, { tables })
    const item = analytic.items.find((i) => i.itemId === GEM_A)
    expect(item?.expectedDrops).toBeCloseTo(2, 12)
    expect(item?.expectedQuantity).toBeCloseTo(6, 12)
  })
})

describe('drawsPerHit: schema', () => {
  const base = {
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
  }

  function bossWith(drawsPerHit: unknown) {
    return {
      ...base,
      tables: [
        {
          id: 't',
          mode: 'independent',
          entries: [
            { node: { kind: 'tableRef', ref: 'gem_drop_table', drawsPerHit }, rate: ACCESS },
          ],
        },
      ],
    }
  }

  it('requires a positive integer', () => {
    for (const bad of [0, -1, 1.5, '10', null]) {
      expect(BossSchema.safeParse(bossWith(bad)).success).toBe(false)
    }
    expect(BossSchema.safeParse(bossWith(10)).success).toBe(true)
  })

  it('is absent from a document that does not set it', () => {
    const parsed = BossSchema.parse({
      ...base,
      tables: [
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: { kind: 'tableRef', ref: 'gem_drop_table' }, rate: ACCESS }],
        },
      ],
    })
    expect(parsed.tables[0]?.entries[0]?.node).not.toHaveProperty('drawsPerHit')
  })
})
