import { describe, expect, it } from 'vitest'
import { BossSchema, QtySpecSchema, RateSchema, TableSchema } from '../src/index'

const itemNode = {
  kind: 'item',
  itemId: 1,
  itemKey: 'thing',
  name: 'Thing',
  qty: { kind: 'exact', n: 1 },
} as const

function parseTable(table: unknown) {
  return TableSchema.safeParse(table)
}

describe('RateSchema', () => {
  it('accepts each rate kind', () => {
    expect(RateSchema.parse({ kind: 'always' })).toEqual({ kind: 'always' })
    expect(RateSchema.parse({ kind: 'weight', weight: 3 }).kind).toBe('weight')
    expect(RateSchema.parse({ kind: 'fixed', num: 1, den: 128 }).kind).toBe('fixed')
    expect(RateSchema.parse({ kind: 'formula', id: 'cox_points' })).toEqual({
      kind: 'formula',
      id: 'cox_points',
      params: {},
    })
  })

  it('rejects a fixed rate above 1 and a non-positive weight', () => {
    expect(RateSchema.safeParse({ kind: 'fixed', num: 2, den: 1 }).success).toBe(false)
    expect(RateSchema.safeParse({ kind: 'weight', weight: 0 }).success).toBe(false)
  })

  it('rejects an unknown formula id', () => {
    expect(RateSchema.safeParse({ kind: 'formula', id: 'made_up' }).success).toBe(false)
  })
})

describe('QtySpecSchema', () => {
  it('rejects an inverted range and an empty choice', () => {
    expect(QtySpecSchema.safeParse({ kind: 'range', min: 5, max: 2 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'range', min: 2, max: 5 }).success).toBe(true)
    expect(QtySpecSchema.safeParse({ kind: 'choice', values: [] }).success).toBe(false)
  })

  it('rejects negative and fractional quantities', () => {
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: -1 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: 1.5 }).success).toBe(false)
  })
})

describe('TableSchema', () => {
  it('applies defaults for rolls and withoutReplacement', () => {
    const table = TableSchema.parse({
      id: 't',
      mode: 'always',
      entries: [{ node: itemNode, rate: { kind: 'always' } }],
    })
    expect(table.rolls).toBe(1)
    expect(table.withoutReplacement).toBe(false)
  })

  it('requires a denominator on weighted tables and forbids one elsewhere', () => {
    expect(
      parseTable({
        id: 't',
        mode: 'weighted',
        entries: [{ node: itemNode, rate: { kind: 'weight', weight: 1 } }],
      }).success
    ).toBe(false)

    expect(
      parseTable({
        id: 't',
        mode: 'independent',
        denominator: 10,
        entries: [{ node: itemNode, rate: { kind: 'fixed', num: 1, den: 10 } }],
      }).success
    ).toBe(false)
  })

  it('pins each mode to the rate kinds it can express', () => {
    const cases: Array<[string, unknown, boolean]> = [
      ['always/always', { mode: 'always', rate: { kind: 'always' } }, true],
      ['always/fixed', { mode: 'always', rate: { kind: 'fixed', num: 1, den: 2 } }, false],
      ['weighted/weight', { mode: 'weighted', rate: { kind: 'weight', weight: 1 } }, true],
      ['weighted/fixed', { mode: 'weighted', rate: { kind: 'fixed', num: 1, den: 2 } }, false],
      ['independent/fixed', { mode: 'independent', rate: { kind: 'fixed', num: 1, den: 2 } }, true],
      ['independent/always', { mode: 'independent', rate: { kind: 'always' } }, true],
      ['independent/weight', { mode: 'independent', rate: { kind: 'weight', weight: 1 } }, false],
      ['preroll/formula', { mode: 'preroll', rate: { kind: 'formula', id: 'barrows_kc' } }, true],
      ['preroll/always', { mode: 'preroll', rate: { kind: 'always' } }, false],
    ]

    for (const [label, { mode, rate }, expected] of cases as Array<
      [string, { mode: string; rate: unknown }, boolean]
    >) {
      const result = parseTable({
        id: 't',
        mode,
        ...(mode === 'weighted' ? { denominator: 10 } : {}),
        entries: [{ node: itemNode, rate }],
      })
      expect(result.success, label).toBe(expected)
    }
  })

  it('forbids repeating a preroll pass', () => {
    expect(
      parseTable({
        id: 't',
        mode: 'preroll',
        rolls: 2,
        entries: [{ node: itemNode, rate: { kind: 'fixed', num: 1, den: 150 } }],
      }).success
    ).toBe(false)
  })

  it('accepts a Rate as rolls but not a weight rate', () => {
    const table = TableSchema.parse({
      id: 't',
      mode: 'independent',
      rolls: { kind: 'fixed', num: 1, den: 4 },
      entries: [{ node: itemNode, rate: { kind: 'fixed', num: 1, den: 2 } }],
    })
    expect(table.rolls).toEqual({ kind: 'fixed', num: 1, den: 4 })

    expect(
      parseTable({
        id: 't',
        mode: 'independent',
        rolls: { kind: 'weight', weight: 2 },
        entries: [{ node: itemNode, rate: { kind: 'fixed', num: 1, den: 2 } }],
      }).success
    ).toBe(false)
  })

  describe('withoutReplacement', () => {
    const weighted = (extra: Record<string, unknown>) => ({
      id: 't',
      mode: 'weighted',
      denominator: 10,
      entries: [
        { node: itemNode, rate: { kind: 'weight', weight: 1 } },
        { node: { ...itemNode, itemId: 2 }, rate: { kind: 'weight', weight: 1 } },
      ],
      ...extra,
    })

    it('is legal on a multi-roll weighted table', () => {
      const table = TableSchema.parse(weighted({ rolls: 2, withoutReplacement: true }))
      expect(table.withoutReplacement).toBe(true)
    })

    it('requires more than one roll', () => {
      expect(parseTable(weighted({ withoutReplacement: true })).success).toBe(false)
      expect(parseTable(weighted({ rolls: 1, withoutReplacement: true })).success).toBe(false)
    })

    it('requires a numeric roll count, not a chance', () => {
      expect(
        parseTable(
          weighted({ rolls: { kind: 'fixed', num: 1, den: 2 }, withoutReplacement: true })
        ).success
      ).toBe(false)
    })

    it('is rejected on non-weighted modes', () => {
      expect(
        parseTable({
          id: 't',
          mode: 'independent',
          rolls: 2,
          withoutReplacement: true,
          entries: [{ node: itemNode, rate: { kind: 'fixed', num: 1, den: 2 } }],
        }).success
      ).toBe(false)
    })
  })

  it('requires oneOf entries to use weight rates', () => {
    const oneOf = (rate: unknown) => ({
      id: 't',
      mode: 'weighted',
      denominator: 10,
      entries: [
        {
          node: { kind: 'oneOf', entries: [{ node: itemNode, rate }] },
          rate: { kind: 'weight', weight: 1 },
        },
      ],
    })
    expect(parseTable(oneOf({ kind: 'weight', weight: 1 })).success).toBe(true)
    expect(parseTable(oneOf({ kind: 'fixed', num: 1, den: 2 })).success).toBe(false)
  })

  it('rejects unknown keys and empty entry lists', () => {
    expect(
      parseTable({
        id: 't',
        mode: 'always',
        entries: [{ node: itemNode, rate: { kind: 'always' } }],
        typo: true,
      }).success
    ).toBe(false)
    expect(parseTable({ id: 't', mode: 'always', entries: [] }).success).toBe(false)
  })
})

describe('item node itemId / itemKey', () => {
  it('accepts a null itemId alongside a required itemKey', () => {
    const result = parseTable({
      id: 't',
      mode: 'always',
      entries: [
        {
          node: {
            kind: 'item',
            itemId: null,
            itemKey: 'clue-scroll-easy',
            name: 'Clue scroll (easy)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'always' },
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an item node with no itemKey', () => {
    const result = parseTable({
      id: 't',
      mode: 'always',
      entries: [
        {
          node: { kind: 'item', itemId: 1, name: 'Thing', qty: { kind: 'exact', n: 1 } },
          rate: { kind: 'always' },
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('never treats 0 as a sentinel: a real itemId of 0 and a null itemId are distinct', () => {
    const zero = parseTable({
      id: 't',
      mode: 'always',
      entries: [
        {
          node: { kind: 'item', itemId: 0, itemKey: 'zero', name: 'Z', qty: { kind: 'exact', n: 1 } },
          rate: { kind: 'always' },
        },
      ],
    })
    expect(zero.success).toBe(true)
    if (zero.success) {
      const node = zero.data.entries[0]?.node
      expect(node && 'itemId' in node ? node.itemId : undefined).toBe(0)
    }
  })
})

describe('BossSchema', () => {
  const base = {
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
    tables: [
      {
        id: 't',
        mode: 'always',
        entries: [{ node: itemNode, rate: { kind: 'always' } }],
      },
    ],
  }

  it('applies document-level defaults', () => {
    const boss = BossSchema.parse(base)
    expect(boss.aliases).toEqual([])
    expect(boss.variants).toEqual(['normal'])
    expect(boss.contextDefaults).toEqual({})
  })

  it('rejects a non-kebab slug', () => {
    expect(BossSchema.safeParse({ ...base, slug: 'Test Boss' }).success).toBe(false)
  })

  it('rejects duplicate table ids', () => {
    expect(
      BossSchema.safeParse({ ...base, tables: [...base.tables, ...base.tables] }).success
    ).toBe(false)
  })

  it('rejects an unknown validation check name', () => {
    expect(
      BossSchema.safeParse({
        ...base,
        validation: { ok: false, checks: [{ check: 'vibes', ok: false }] },
      }).success
    ).toBe(false)
  })
})
