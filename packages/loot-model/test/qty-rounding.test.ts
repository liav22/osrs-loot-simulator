import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  applyQtyMultiplier,
  expectedValue,
  meanScaledQty,
  simulate,
  type BossInput,
} from '../src/index'
import { ctxWith, dropQuantity, makeBoss } from './helpers'

/**
 * `qtyRounding` — how a `qtyMultiplier` turns a rolled integer quantity into a
 * final one. Three real, separately-cited wiki rules, not one:
 *
 *   round       round(qty * m)                 default; prior behaviour
 *   truncDelta  qty + trunc(qty * (m - 1))     Doom of Mokhaiotl's stated rule
 *   ceilDelta   qty + ceil(qty * (m - 1))      Zalcano's "+10% (rounded up)"
 *
 * The delta framing is the load-bearing part — see the divergence suite below.
 */

const ctx = ctxWith()

describe('applyQtyMultiplier: the three modes', () => {
  it("reproduces Doom of Mokhaiotl's per-level table exactly (truncDelta)", () => {
    // Qn = Q3 + trunc(Q3 * Mn), from the page's own Mechanics table.
    const cases: [q: number, m: number, expected: number][] = [
      [7, 1 - 0.5, 7 + Math.trunc(7 * -0.5)], // level 1, M=-0.5  -> 4
      [5, 1 - 0.35, 4], // level 2, M=-0.35 -> 5 + trunc(-1.75) = 4
      [9, 1 + 0.0, 9], // level 3, baseline, unchanged
      [8, 1 + 0.2, 9], // level 9+, M=0.2 -> 8 + trunc(1.6) = 9
      [3, 1 + 0.17, 3], // level 8, M=0.17 -> 3 + trunc(0.51) = 3
    ]
    for (const [q, m, expected] of cases) {
      expect(applyQtyMultiplier(q, m, 'truncDelta'), `qty ${q} x ${m}`).toBe(expected)
    }
  })

  it("reproduces Zalcano's '+10% (rounded up)' (ceilDelta)", () => {
    // Any non-zero remainder rounds the BONUS up, so even 1 item gains 1.
    expect(applyQtyMultiplier(1, 1.1, 'ceilDelta')).toBe(2)
    expect(applyQtyMultiplier(10, 1.1, 'ceilDelta')).toBe(11)
    expect(applyQtyMultiplier(15, 1.1, 'ceilDelta')).toBe(17) // 15 + ceil(1.5)
    expect(applyQtyMultiplier(100, 1.1, 'ceilDelta')).toBe(110)
  })

  it('round is the prior behaviour, unchanged', () => {
    expect(applyQtyMultiplier(7, 2, 'round')).toBe(14)
    expect(applyQtyMultiplier(5, 0.65, 'round')).toBe(3)
    expect(applyQtyMultiplier(3, 1.5, 'round')).toBe(5) // round(4.5) = 5
  })
})

describe('why the mode rounds the delta and not the product', () => {
  it('delta-trunc and product-trunc agree for m > 1 but not for m < 1', () => {
    // For m > 1 the scaled part is positive, so trunc-of-delta and
    // trunc-of-product coincide mathematically — this is why the distinction
    // is easy to miss. (They agree here only because `applyQtyMultiplier`
    // snaps float noise; the raw `q*(m-1)` form does NOT reproduce
    // `trunc(q*1.2)` — see the float-safety suite below.)
    for (let q = 1; q <= 200; q++) {
      expect(applyQtyMultiplier(q, 1.2, 'truncDelta')).toBe(Math.trunc(q * 1.2))
    }
    // For m < 1 the scaled part is negative and trunc rounds toward zero from
    // the other side, so they diverge on almost every value.
    let divergent = 0
    for (let q = 1; q <= 200; q++) {
      if (applyQtyMultiplier(q, 0.65, 'truncDelta') !== Math.trunc(q * 0.65)) divergent += 1
    }
    // 190, measured against the snapped implementation (an unsnapped one
    // gives 191 — the extra case is one the snap corrects). Pinned exactly
    // because it is a regression anchor, not a wiki-stated figure.
    expect(divergent).toBe(190)
    // The concrete case that motivated the field.
    expect(applyQtyMultiplier(5, 0.65, 'truncDelta')).toBe(4)
    expect(Math.trunc(5 * 0.65)).toBe(3)
  })

  it('the default and truncDelta genuinely disagree — this is not an edge case', () => {
    // Roughly half of all quantities, at every positive Doom multiplier.
    const counts = [0.05, 0.1, 0.12, 0.14, 0.17, 0.2].map((M) => {
      let n = 0
      for (let q = 1; q <= 200; q++) {
        if (applyQtyMultiplier(q, 1 + M, 'truncDelta') !== applyQtyMultiplier(q, 1 + M, 'round')) n += 1
      }
      return n
    })
    for (const n of counts) expect(n).toBeGreaterThanOrEqual(80)

    // m = 0.5 and m = 1 are the only values in Doom's table where every mode
    // agrees, which is why a spot-check on level 1 alone would have missed it.
    for (let q = 1; q <= 200; q++) {
      expect(applyQtyMultiplier(q, 0.5, 'truncDelta')).toBe(applyQtyMultiplier(q, 0.5, 'round'))
    }
  })
})

describe('meanScaledQty: the analytic path is exact, not a scaled mean', () => {
  it('enumerates the distribution rather than scaling its mean', () => {
    const qty = { kind: 'range', min: 1, max: 4 } as const
    // Scaling the mean would give 2.5 * 0.65 = 1.625. The true mean of the
    // rounded values is (1+2+2+3)/4 = 2 under truncDelta.
    expect(meanScaledQty(qty, 0.65, 'truncDelta')).toBeCloseTo(2, 12)
    expect(2.5 * 0.65).not.toBeCloseTo(2, 2)
  })

  it('is a no-op at multiplier 1', () => {
    const qty = { kind: 'range', min: 1, max: 10 } as const
    expect(meanScaledQty(qty, 1, 'truncDelta')).toBeCloseTo(5.5, 12)
  })
})

describe('end to end: simulate and expectedValue agree exactly', () => {
  function scaledBoss(qtyRounding: 'round' | 'truncDelta' | 'ceilDelta' | undefined) {
    const table: BossInput['tables'][number] = {
      id: 'scaled',
      mode: 'always',
      qtyMultiplier: 0.65,
      entries: [
        {
          node: { kind: 'item', itemId: 1, itemKey: 'ore', name: 'ore', qty: { kind: 'range', min: 1, max: 9 } },
          rate: { kind: 'always' },
        },
      ],
    }
    if (qtyRounding !== undefined) table.qtyRounding = qtyRounding
    return makeBoss([table])
  }

  function scaledBossAt(m: number, qtyRounding: 'round' | 'truncDelta' | 'ceilDelta') {
    return makeBoss([
      {
        id: 'scaled',
        mode: 'always',
        qtyMultiplier: m,
        qtyRounding,
        entries: [
          {
            node: { kind: 'item', itemId: 1, itemKey: 'ore', name: 'ore', qty: { kind: 'range', min: 1, max: 9 } },
            rate: { kind: 'always' },
          },
        ],
      },
    ])
  }

  it('truncDelta: 500k simulated kills match the analytic mean', () => {
    const boss = scaledBoss('truncDelta')
    const n = 500_000
    const observed = dropQuantity(simulate(boss, n, ctx, 8).drops, 1) / n
    const analytic = expectedValue(boss, ctx).items[0]?.expectedQuantity ?? 0
    expect(observed).toBeCloseTo(analytic, 2)
    // Hand-computed: mean over q=1..9 of q + trunc(q * -0.35).
    let total = 0
    for (let q = 1; q <= 9; q++) total += q + Math.trunc(q * -0.35)
    expect(analytic).toBeCloseTo(total / 9, 12)
  })

  it('truncDelta and ceilDelta coincide below m = 1, and separate above it', () => {
    // Not a quirk of the fixture: below 1 the delta is negative, and trunc and
    // ceil both round a negative number toward zero, so they are the SAME
    // function there. They can only differ when the delta is positive.
    const at = (m: number, mode: 'round' | 'truncDelta' | 'ceilDelta'): number =>
      expectedValue(scaledBossAt(m, mode), ctx).items[0]?.expectedQuantity ?? 0

    expect(at(0.65, 'truncDelta')).toBeCloseTo(at(0.65, 'ceilDelta'), 12)
    expect(at(0.65, 'truncDelta')).toBeGreaterThan(at(0.65, 'round'))

    // Above 1 all three separate — this is the range Zalcano and Doom's
    // positive levels actually live in.
    expect(at(1.1, 'ceilDelta')).toBeGreaterThan(at(1.1, 'truncDelta'))
    expect(at(1.1, 'round')).toBeGreaterThan(at(1.1, 'truncDelta'))
  })

  it('omitting the field is identical to round — the default is behaviour-preserving', () => {
    const absent = expectedValue(scaledBoss(undefined), ctx).items[0]?.expectedQuantity
    const explicit = expectedValue(scaledBoss('round'), ctx).items[0]?.expectedQuantity
    expect(absent).toBeCloseTo(explicit ?? -1, 12)

    const n = 50_000
    expect(dropQuantity(simulate(scaledBoss(undefined), n, ctx, 4).drops, 1)).toBe(
      dropQuantity(simulate(scaledBoss('round'), n, ctx, 4).drops, 1)
    )
  })
})

describe('qtyRounding: nesting and schema', () => {
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

  it("a tableRef's own mode overrides the enclosing one (most-specific-wins)", () => {
    const shared = new Map([
      [
        'inner',
        BossSchema.parse({
          ...base,
          tables: [
            {
              id: 'inner',
              mode: 'always',
              entries: [
                {
                  node: { kind: 'item', itemId: 1, itemKey: 'ore', name: 'ore', qty: { kind: 'exact', n: 5 } },
                  rate: { kind: 'always' },
                },
              ],
            },
          ],
        }).tables[0]!,
      ],
    ])

    const boss = makeBoss([
      {
        id: 'outer',
        mode: 'always',
        qtyMultiplier: 1,
        entries: [
          {
            node: { kind: 'tableRef', ref: 'inner', qtyMultiplier: 0.65, qtyRounding: 'truncDelta' },
            rate: { kind: 'always' },
          },
        ],
      },
    ])

    // 5 + trunc(5 * -0.35) = 4, not round(3.25) = 3.
    expect(expectedValue(boss, ctx, { tables: shared }).items[0]?.expectedQuantity).toBeCloseTo(4, 12)
    expect(dropQuantity(simulate(boss, 100, ctx, 1, { tables: shared }).drops, 1)).toBe(400)
  })

  it('rejects a rounding mode with no multiplier to round, on both carriers', () => {
    const onTable = BossSchema.safeParse({
      ...base,
      tables: [
        {
          id: 't',
          mode: 'always',
          qtyRounding: 'truncDelta',
          entries: [
            {
              node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'a', qty: { kind: 'exact', n: 1 } },
              rate: { kind: 'always' },
            },
          ],
        },
      ],
    })
    expect(onTable.success).toBe(false)

    const onNode = BossSchema.safeParse({
      ...base,
      tables: [
        {
          id: 't',
          mode: 'always',
          entries: [
            { node: { kind: 'tableRef', ref: 'x', qtyRounding: 'truncDelta' }, rate: { kind: 'always' } },
          ],
        },
      ],
    })
    expect(onNode.success).toBe(false)
  })

  it('is absent from documents that do not set it', () => {
    const parsed = BossSchema.parse({
      ...base,
      tables: [
        {
          id: 't',
          mode: 'always',
          qtyMultiplier: 2,
          entries: [
            {
              node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'a', qty: { kind: 'exact', n: 1 } },
              rate: { kind: 'always' },
            },
          ],
        },
      ],
    })
    expect(parsed.tables[0]).not.toHaveProperty('qtyRounding')
  })
})

describe('float safety: decimal multipliers must not gain or lose an item', () => {
  it("Zalcano's +10% of 50 items is 55, not 56", () => {
    // `50 * 1.1 - 50` is 5.000000000000007, so an unsnapped `ceil` yields 6
    // and the MVP is handed a whole extra item. This is the exact off-by-one
    // the rounding field exists to prevent, so it must not reintroduce it.
    expect(applyQtyMultiplier(50, 1.1, 'ceilDelta')).toBe(55)
    expect(Math.ceil(50 * 1.1 - 50)).toBe(6) // what an unsnapped version gives

    // Both corrections are load-bearing, measured over the real multipliers
    // in use (Doom's nine levels, Zalcano's 1.1, plus 1.5/2) for qty 1..2000:
    // the naive `q*(m-1)` form is wrong in 1,072 cases and `q*m - q` alone is
    // still wrong in 324. Neither shortcut is safe on its own.
    expect(applyQtyMultiplier(90, 1.1, 'ceilDelta')).toBe(99)
    expect(applyQtyMultiplier(100, 1.1, 'ceilDelta')).toBe(110)
  })

  it('the naive q*(m-1) form is wrong where q*m-q is right', () => {
    // 1.2 - 1 === 0.19999999999999996, so 5 * that truncates to 0.
    expect(Math.trunc(5 * (1.2 - 1))).toBe(0)
    expect(applyQtyMultiplier(5, 1.2, 'truncDelta')).toBe(6)
  })

  it('an exact multiplier is unaffected either way', () => {
    for (let q = 1; q <= 50; q++) {
      expect(applyQtyMultiplier(q, 2, 'truncDelta')).toBe(q * 2)
      expect(applyQtyMultiplier(q, 2, 'ceilDelta')).toBe(q * 2)
      expect(applyQtyMultiplier(q, 2, 'round')).toBe(q * 2)
    }
  })
})
