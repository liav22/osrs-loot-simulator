import { describe, expect, it } from 'vitest'
import {
  CircularTableRefError,
  createFormulaRegistry,
  DEFAULT_LOG_LIMIT,
  simulate,
  TableSchema,
  UnresolvedTableRefError,
  WeightsExceedDenominatorError,
  type Table,
} from '../src/index'
import { ctxWith, dropCount, dropQuantity, makeBoss } from './helpers'

const ctx = ctxWith()

function item(itemId: number, name: string, qty = 1) {
  return { kind: 'item', itemId, name, qty: { kind: 'exact', n: qty } } as const
}

describe('simulate', () => {
  it('is reproducible for a seed and diverges for another', () => {
    const boss = makeBoss([
      {
        id: 'main',
        mode: 'weighted',
        denominator: 10,
        entries: [
          { node: item(1, 'A'), rate: { kind: 'weight', weight: 3 } },
          { node: item(2, 'B'), rate: { kind: 'weight', weight: 2 } },
        ],
      },
    ])
    const a = simulate(boss, 5000, ctx, 42)
    const b = simulate(boss, 5000, ctx, 42)
    const c = simulate(boss, 5000, ctx, 43)
    expect(a).toEqual(b)
    expect(a.drops).not.toEqual(c.drops)
  })

  it('rejects a non-integer or negative kill count and handles zero kills', () => {
    const boss = makeBoss([
      { id: 't', mode: 'always', entries: [{ node: item(1, 'A'), rate: { kind: 'always' } }] },
    ])
    expect(() => simulate(boss, -1, ctx, 1)).toThrow(RangeError)
    expect(() => simulate(boss, 1.5, ctx, 1)).toThrow(RangeError)
    const empty = simulate(boss, 0, ctx, 1)
    expect(empty.kills).toBe(0)
    expect(empty.gpPerKill).toBe(0)
    expect(empty.log).toEqual([])
  })

  describe('modes', () => {
    it('always drops every entry on every kill', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'always',
          entries: [
            { node: item(1, 'A'), rate: { kind: 'always' } },
            { node: item(2, 'B', 3), rate: { kind: 'always' } },
          ],
        },
      ])
      const result = simulate(boss, 500, ctx, 1)
      expect(dropCount(result.drops, 1)).toBe(500)
      expect(dropCount(result.drops, 2)).toBe(500)
      expect(dropQuantity(result.drops, 2)).toBe(1500)
    })

    it('weighted picks one entry and leaves the shortfall as nothing', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'weighted',
          denominator: 100,
          entries: [
            { node: item(1, 'A'), rate: { kind: 'weight', weight: 30 } },
            { node: item(2, 'B'), rate: { kind: 'weight', weight: 20 } },
          ],
        },
      ])
      const n = 200_000
      const result = simulate(boss, n, ctx, 7)
      expect(dropCount(result.drops, 1) / n).toBeCloseTo(0.3, 2)
      expect(dropCount(result.drops, 2) / n).toBeCloseTo(0.2, 2)
      // The two can never co-occur: exactly one selection per roll.
      const both = result.log.filter((kill) => kill.drops.length > 1)
      expect(both).toHaveLength(0)
    })

    it('independent rolls every entry separately so they can stack', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'independent',
          entries: [
            { node: item(1, 'A'), rate: { kind: 'fixed', num: 1, den: 2 } },
            { node: item(2, 'B'), rate: { kind: 'fixed', num: 1, den: 2 } },
          ],
        },
      ])
      const n = 100_000
      const result = simulate(boss, n, ctx, 11)
      expect(dropCount(result.drops, 1) / n).toBeCloseTo(0.5, 2)
      expect(dropCount(result.drops, 2) / n).toBeCloseTo(0.5, 2)
      expect(result.log.some((kill) => kill.drops.length === 2)).toBe(true)
    })

    it('preroll checks entries in order and stops at the first hit', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'preroll',
          entries: [
            { node: item(1, 'A'), rate: { kind: 'fixed', num: 1, den: 1 } },
            { node: item(2, 'B'), rate: { kind: 'fixed', num: 1, den: 1 } },
          ],
        },
      ])
      const result = simulate(boss, 1000, ctx, 5)
      expect(dropCount(result.drops, 1)).toBe(1000)
      expect(dropCount(result.drops, 2)).toBe(0)
    })

    it('repeats a table `rolls` times', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'weighted',
          rolls: 2,
          denominator: 10,
          entries: [{ node: item(1, 'A'), rate: { kind: 'weight', weight: 10 } }],
        },
      ])
      const result = simulate(boss, 1000, ctx, 3)
      expect(dropCount(result.drops, 1)).toBe(2000)
    })

    it('treats a Rate as rolls as a chance to roll the table once', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'always',
          rolls: { kind: 'fixed', num: 1, den: 4 },
          entries: [{ node: item(1, 'A'), rate: { kind: 'always' } }],
        },
      ])
      const n = 100_000
      const result = simulate(boss, n, ctx, 9)
      expect(dropCount(result.drops, 1) / n).toBeCloseTo(0.25, 2)
    })
  })

  describe('preroll chain short-circuiting', () => {
    const boss = makeBoss([
      { id: 'always', mode: 'always', entries: [{ node: item(1, 'A'), rate: { kind: 'always' } }] },
      {
        id: 'preroll',
        mode: 'preroll',
        entries: [{ node: item(2, 'Unique'), rate: { kind: 'fixed', num: 1, den: 1 } }],
      },
      {
        id: 'main',
        mode: 'weighted',
        denominator: 10,
        entries: [{ node: item(3, 'Main'), rate: { kind: 'weight', weight: 10 } }],
      },
      {
        id: 'tertiary',
        mode: 'independent',
        entries: [{ node: item(4, 'Clue'), rate: { kind: 'fixed', num: 1, den: 1 } }],
      },
    ])

    it('suppresses the weighted main table but not always or independent tables', () => {
      const result = simulate(boss, 500, ctx, 17)
      expect(dropCount(result.drops, 2)).toBe(500) // preroll hit every kill
      expect(dropCount(result.drops, 3)).toBe(0) // main suppressed
      expect(dropCount(result.drops, 1)).toBe(500) // always unaffected
      expect(dropCount(result.drops, 4)).toBe(500) // tertiary stacks
    })

    it('rolls the main table when the preroll misses', () => {
      const missing = makeBoss([
        {
          id: 'preroll',
          mode: 'preroll',
          entries: [{ node: item(2, 'Unique'), rate: { kind: 'fixed', num: 0, den: 1 } }],
        },
        {
          id: 'main',
          mode: 'weighted',
          denominator: 10,
          entries: [{ node: item(3, 'Main'), rate: { kind: 'weight', weight: 10 } }],
        },
      ])
      const result = simulate(missing, 500, ctx, 19)
      expect(dropCount(result.drops, 2)).toBe(0)
      expect(dropCount(result.drops, 3)).toBe(500)
    })
  })

  describe('withoutReplacement', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'weighted',
        rolls: 3,
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

    it('never draws the same entry twice in one kill', () => {
      const result = simulate(boss, 5000, ctx, 23, { logLimit: 5000 })
      for (const kill of result.log) {
        const ids = kill.drops.map((drop) => drop.itemId)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBeLessThanOrEqual(3)
      }
    })

    it('draws every entry with equal probability when weights are equal', () => {
      const n = 200_000
      const result = simulate(boss, n, ctx, 29)
      const rates = [1, 2, 3, 4].map((id) => dropCount(result.drops, id) / n)
      for (const rate of rates) expect(rate).toBeCloseTo(0.75, 2)
    })

    it('leaves the nothing remainder in the pool, so fewer than `rolls` items can drop', () => {
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
      const result = simulate(withRemainder, 2000, ctx, 31, { logLimit: 2000 })
      expect(result.log.some((kill) => kill.drops.length === 0)).toBe(true)
      expect(result.log.some((kill) => kill.drops.length === 2)).toBe(true)
      expect(result.log.every((kill) => kill.drops.length <= 2)).toBe(true)
    })
  })

  describe('nested nodes', () => {
    it('resolves a tableRef against the supplied shared tables', () => {
      const shared: Table = TableSchema.parse({
        id: 'rare_drop_table',
        mode: 'weighted',
        denominator: 2,
        entries: [{ node: item(99, 'Dragon spear'), rate: { kind: 'weight', weight: 1 } }],
      })
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 10,
          entries: [
            { node: { kind: 'tableRef', ref: 'rare_drop_table' }, rate: { kind: 'weight', weight: 10 } },
          ],
        },
      ])
      const n = 20_000
      const result = simulate(boss, n, ctx, 37, {
        tables: new Map([['rare_drop_table', shared]]),
      })
      expect(dropCount(result.drops, 99) / n).toBeCloseTo(0.5, 2)
    })

    it('throws when a tableRef cannot be resolved', () => {
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 1,
          entries: [{ node: { kind: 'tableRef', ref: 'missing' }, rate: { kind: 'weight', weight: 1 } }],
        },
      ])
      expect(() => simulate(boss, 1, ctx, 1)).toThrow(UnresolvedTableRefError)
    })

    it('detects a cycle instead of recursing forever', () => {
      const a: Table = TableSchema.parse({
        id: 'a',
        mode: 'weighted',
        denominator: 1,
        entries: [{ node: { kind: 'tableRef', ref: 'b' }, rate: { kind: 'weight', weight: 1 } }],
      })
      const b: Table = TableSchema.parse({
        id: 'b',
        mode: 'weighted',
        denominator: 1,
        entries: [{ node: { kind: 'tableRef', ref: 'a' }, rate: { kind: 'weight', weight: 1 } }],
      })
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 1,
          entries: [{ node: { kind: 'tableRef', ref: 'a' }, rate: { kind: 'weight', weight: 1 } }],
        },
      ])
      expect(() =>
        simulate(boss, 1, ctx, 1, {
          tables: new Map([
            ['a', a],
            ['b', b],
          ]),
        })
      ).toThrow(CircularTableRefError)
    })

    it('treats oneOf as an inline table normalised over its own weights', () => {
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 10,
          entries: [
            {
              node: {
                kind: 'oneOf',
                entries: [
                  { node: item(1, 'A'), rate: { kind: 'weight', weight: 3 } },
                  { node: item(2, 'B'), rate: { kind: 'weight', weight: 1 } },
                ],
              },
              rate: { kind: 'weight', weight: 10 },
            },
          ],
        },
      ])
      const n = 100_000
      const result = simulate(boss, n, ctx, 41)
      expect(dropCount(result.drops, 1) / n).toBeCloseTo(0.75, 2)
      expect(dropCount(result.drops, 2) / n).toBeCloseTo(0.25, 2)
    })
  })

  describe('conditions', () => {
    it('drops entries whose conditions fail before any rolling happens', () => {
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 10,
          entries: [
            {
              node: item(1, 'Members thing'),
              rate: { kind: 'weight', weight: 10 },
              conditions: [{ kind: 'members', value: true }],
            },
          ],
        },
      ])
      expect(dropCount(simulate(boss, 100, ctxWith({ members: true }), 1).drops, 1)).toBe(100)
      expect(simulate(boss, 100, ctxWith({ members: false }), 1).drops).toEqual([])
    })
  })

  describe('quantities', () => {
    it('rolls a range uniformly and a choice from its values', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'always',
          entries: [
            {
              node: { kind: 'item', itemId: 1, name: 'Ranged', qty: { kind: 'range', min: 2, max: 4 } },
              rate: { kind: 'always' },
            },
            {
              node: {
                kind: 'item',
                itemId: 2,
                name: 'Chosen',
                qty: { kind: 'choice', values: [10, 20] },
              },
              rate: { kind: 'always' },
            },
          ],
        },
      ])
      const n = 60_000
      const result = simulate(boss, n, ctx, 43, { logLimit: n })
      expect(dropQuantity(result.drops, 1) / n).toBeCloseTo(3, 1)
      expect(dropQuantity(result.drops, 2) / n).toBeCloseTo(15, 1)

      const rangedValues = new Set(
        result.log.flatMap((kill) => kill.drops.filter((d) => d.itemId === 1).map((d) => d.qty))
      )
      expect([...rangedValues].sort()).toEqual([2, 3, 4])
      const chosenValues = new Set(
        result.log.flatMap((kill) => kill.drops.filter((d) => d.itemId === 2).map((d) => d.qty))
      )
      expect([...chosenValues].sort((a, b) => a - b)).toEqual([10, 20])
    })
  })

  describe('gp and logging', () => {
    const boss = makeBoss([
      {
        id: 't',
        mode: 'always',
        entries: [{ node: item(1, 'A', 2), rate: { kind: 'always' } }],
      },
    ])

    it('values drops with the supplied price lookup', () => {
      const result = simulate(boss, 100, ctx, 1, { prices: (id) => (id === 1 ? 50 : 0) })
      expect(result.gpTotal).toBe(100 * 2 * 50)
      expect(result.gpPerKill).toBe(100)
    })

    it('reports zero gp when no prices are supplied', () => {
      expect(simulate(boss, 100, ctx, 1).gpTotal).toBe(0)
    })

    it('caps the per-kill log at the first 1,000 kills by default', () => {
      const result = simulate(boss, 5000, ctx, 1)
      expect(result.log).toHaveLength(DEFAULT_LOG_LIMIT)
      expect(result.log[0]?.kill).toBe(1)
      expect(result.log.at(-1)?.kill).toBe(DEFAULT_LOG_LIMIT)
      expect(simulate(boss, 5000, ctx, 1, { logLimit: 10 }).log).toHaveLength(10)
    })
  })

  describe('compile-time guards', () => {
    it('refuses a weighted table whose applicable weights exceed its denominator', () => {
      const boss = makeBoss([
        {
          id: 'main',
          mode: 'weighted',
          denominator: 5,
          entries: [
            { node: item(1, 'A'), rate: { kind: 'weight', weight: 4 } },
            { node: item(2, 'B'), rate: { kind: 'weight', weight: 4 } },
          ],
        },
      ])
      expect(() => simulate(boss, 1, ctx, 1)).toThrow(WeightsExceedDenominatorError)
    })

    it('surfaces an unimplemented formula rather than rolling with a zero rate', () => {
      const boss = makeBoss([
        {
          id: 't',
          mode: 'independent',
          entries: [
            { node: item(1, 'A'), rate: { kind: 'formula', id: 'cox_points', params: {} } },
          ],
        },
      ])
      expect(() => simulate(boss, 1, ctx, 1)).toThrow(/not implemented/)
      const registry = createFormulaRegistry({ cox_points: () => 1 })
      expect(dropCount(simulate(boss, 100, ctx, 1, { formulas: registry }).drops, 1)).toBe(100)
    })
  })
})
