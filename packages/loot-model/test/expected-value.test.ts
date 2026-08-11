import { describe, expect, it } from 'vitest'
import {
  expectedValue,
  MAX_WITHOUT_REPLACEMENT_ROLLS,
  simulate,
  UnsupportedExpectedValueError,
} from '../src/index'
import { ctxWith, makeBoss } from './helpers'

const ctx = ctxWith()

function item(itemId: number, name: string, qty = 1) {
  return {
    kind: 'item',
    itemId,
    itemKey: `item-${itemId}`,
    name,
    qty: { kind: 'exact', n: qty },
  } as const
}

function expectedFor(result: ReturnType<typeof expectedValue>, itemId: number): number {
  return result.items.find((entry) => entry.itemId === itemId)?.expectedQuantity ?? 0
}

/** Every analytic figure below is also checked against a run of the simulator. */
function agreesWithSimulation(
  boss: Parameters<typeof simulate>[0],
  seed: number,
  n = 200_000,
  tolerance = 0.03
): void {
  const analytic = expectedValue(boss, ctx)
  const observed = simulate(boss, n, ctx, seed)
  for (const item of analytic.items) {
    const sampled = (observed.drops.find((d) => d.itemId === item.itemId)?.quantity ?? 0) / n
    const slack = Math.max(tolerance * Math.abs(item.expectedQuantity), 0.02)
    expect(Math.abs(sampled - item.expectedQuantity), `item ${item.itemId}`).toBeLessThan(slack)
  }
}

describe('expectedValue', () => {
  it('counts always entries once per roll', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'always',
        rolls: 2,
        entries: [{ node: item(1, 'A', 3), rate: { kind: 'always' } }],
      },
    ])
    expect(expectedFor(expectedValue(boss, ctx), 1)).toBe(6)
  })

  it('divides weights by the denominator, leaving the remainder as nothing', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'weighted',
        denominator: 100,
        entries: [
          { node: item(1, 'A'), rate: { kind: 'weight', weight: 30 } },
          { node: item(2, 'B', 10), rate: { kind: 'weight', weight: 20 } },
        ],
      },
    ])
    const result = expectedValue(boss, ctx)
    expect(expectedFor(result, 1)).toBeCloseTo(0.3, 12)
    expect(expectedFor(result, 2)).toBeCloseTo(2, 12)
    agreesWithSimulation(boss, 101)
  })

  it('multiplies weighted entries by the roll count', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'weighted',
        rolls: 2,
        denominator: 100,
        entries: [{ node: item(1, 'A'), rate: { kind: 'weight', weight: 30 } }],
      },
    ])
    expect(expectedFor(expectedValue(boss, ctx), 1)).toBeCloseTo(0.6, 12)
    agreesWithSimulation(boss, 103)
  })

  it('walks preroll entries in order, discounting by the earlier misses', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'preroll',
        entries: [
          { node: item(1, 'A'), rate: { kind: 'fixed', num: 1, den: 2 } },
          { node: item(2, 'B'), rate: { kind: 'fixed', num: 1, den: 2 } },
        ],
      },
    ])
    const result = expectedValue(boss, ctx)
    expect(expectedFor(result, 1)).toBeCloseTo(0.5, 12)
    expect(expectedFor(result, 2)).toBeCloseTo(0.25, 12)
    agreesWithSimulation(boss, 105)
  })

  it('discounts the main chain by the chance the preroll already hit', () => {
    const boss = makeBoss([
      {
        id: 'preroll',
        mode: 'preroll',
        entries: [{ node: item(1, 'Unique'), rate: { kind: 'fixed', num: 1, den: 4 } }],
      },
      {
        id: 'main',
        mode: 'weighted',
        denominator: 10,
        entries: [{ node: item(2, 'Main'), rate: { kind: 'weight', weight: 10 } }],
      },
      {
        id: 'tertiary',
        mode: 'independent',
        entries: [{ node: item(3, 'Clue'), rate: { kind: 'fixed', num: 1, den: 2 } }],
      },
      {
        id: 'always',
        mode: 'always',
        entries: [{ node: item(4, 'Bones'), rate: { kind: 'always' } }],
      },
    ])
    const result = expectedValue(boss, ctx)
    expect(expectedFor(result, 1)).toBeCloseTo(0.25, 12)
    expect(expectedFor(result, 2)).toBeCloseTo(0.75, 12)
    // Independent and always tables sit outside the chain.
    expect(expectedFor(result, 3)).toBeCloseTo(0.5, 12)
    expect(expectedFor(result, 4)).toBeCloseTo(1, 12)
    agreesWithSimulation(boss, 107)
  })

  it('handles a Rate as rolls as an expected roll count', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'always',
        rolls: { kind: 'fixed', num: 1, den: 4 },
        entries: [{ node: item(1, 'A'), rate: { kind: 'always' } }],
      },
    ])
    expect(expectedFor(expectedValue(boss, ctx), 1)).toBeCloseTo(0.25, 12)
    agreesWithSimulation(boss, 109)
  })

  it('averages range and choice quantities', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'always',
        entries: [
          {
            node: {
              kind: 'item',
              itemId: 1,
              itemKey: 'item-1',
              name: 'A',
              qty: { kind: 'range', min: 2, max: 4 },
            },
            rate: { kind: 'always' },
          },
          {
            node: {
              kind: 'item',
              itemId: 2,
              itemKey: 'item-2',
              name: 'B',
              qty: { kind: 'choice', values: [10, 20, 60] },
            },
            rate: { kind: 'always' },
          },
        ],
      },
    ])
    const result = expectedValue(boss, ctx)
    expect(expectedFor(result, 1)).toBe(3)
    expect(expectedFor(result, 2)).toBe(30)
  })

  it('descends into oneOf and tableRef nodes', () => {
    const boss = makeBoss([
      {
        id: 'main',
        mode: 'weighted',
        denominator: 4,
        entries: [
          {
            node: {
              kind: 'oneOf',
              entries: [
                { node: item(1, 'A'), rate: { kind: 'weight', weight: 3 } },
                { node: item(2, 'B'), rate: { kind: 'weight', weight: 1 } },
              ],
            },
            rate: { kind: 'weight', weight: 2 },
          },
        ],
      },
    ])
    const result = expectedValue(boss, ctx)
    expect(expectedFor(result, 1)).toBeCloseTo(0.5 * 0.75, 12)
    expect(expectedFor(result, 2)).toBeCloseTo(0.5 * 0.25, 12)
    agreesWithSimulation(boss, 111)
  })

  it('prices expected quantities', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'weighted',
        denominator: 10,
        entries: [{ node: item(1, 'A', 5), rate: { kind: 'weight', weight: 2 } }],
      },
    ])
    const result = expectedValue(boss, ctx, { prices: () => 100 })
    expect(result.gpPerKill).toBeCloseTo(0.2 * 5 * 100, 9)
  })

  describe('withoutReplacement', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'weighted',
        rolls: 2,
        withoutReplacement: true,
        denominator: 4,
        entries: [
          { node: item(1, 'A'), rate: { kind: 'weight', weight: 1 } },
          { node: item(2, 'B'), rate: { kind: 'weight', weight: 1 } },
          { node: item(3, 'C'), rate: { kind: 'weight', weight: 1 } },
          { node: item(4, 'D'), rate: { kind: 'weight', weight: 1 } },
        ],
      },
    ])

    it('matches the closed form for a uniform pool', () => {
      // Two draws from four equal entries with no remainder: P(drawn) = 1/2.
      const result = expectedValue(boss, ctx)
      for (const itemId of [1, 2, 3, 4]) {
        expect(expectedFor(result, itemId)).toBeCloseTo(0.5, 12)
      }
    })

    it('keeps the nothing remainder in the pool across draws', () => {
      const withRemainder = makeBoss([
        {
          id: 't',
          mode: 'weighted',
          rolls: 2,
          withoutReplacement: true,
          denominator: 10,
          entries: [
            { node: item(1, 'A'), rate: { kind: 'weight', weight: 1 } },
            { node: item(2, 'B'), rate: { kind: 'weight', weight: 1 } },
          ],
        },
      ])
      // First draw: 1/10 for A. Second draw: either B was taken (1/10, pool 9,
      // A at 1/9) or nothing was taken (8/10, pool 10, A at 1/10).
      const expectedA = 1 / 10 + (1 / 10) * (1 / 9) + (8 / 10) * (1 / 10)
      expect(expectedFor(expectedValue(withRemainder, ctx), 1)).toBeCloseTo(expectedA, 12)
      agreesWithSimulation(withRemainder, 113, 400_000)
    })

    it('agrees with the simulator', () => {
      agreesWithSimulation(boss, 115)
    })

    it('refuses to enumerate more rolls than it can afford', () => {
      const tooMany = makeBoss([
        {
          id: 't',
          mode: 'weighted',
          rolls: MAX_WITHOUT_REPLACEMENT_ROLLS + 1,
          withoutReplacement: true,
          denominator: 10,
          entries: [
            { node: item(1, 'A'), rate: { kind: 'weight', weight: 1 } },
            { node: item(2, 'B'), rate: { kind: 'weight', weight: 1 } },
          ],
        },
      ])
      expect(() => expectedValue(tooMany, ctx)).toThrow(UnsupportedExpectedValueError)
    })
  })
})
