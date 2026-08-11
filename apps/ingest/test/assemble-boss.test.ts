import { describe, expect, it } from 'vitest'
import { assembleBoss } from '../src/parse/assemble-boss.js'
import type { ItemAllowlist } from '../src/items/allowlist.js'
import type { ItemIndex } from '../src/items/index.js'
import type { ParsedTableGroup } from '../src/parse/build-tables.js'
import type { RdtAccessResult } from '../src/parse/rdt-access.js'

const noRdtAccess: RdtAccessResult = { lines: [], unresolved: [] }

const itemIndex: ItemIndex = {
  itemIndexVersion: 2,
  generatedAt: '2026-08-11T00:00:00.000Z',
  rowCount: 2,
  entries: [
    { itemName: 'Bull bones', itemId: 33115, rawIds: ['33115'], source: 'infobox_item' },
    { itemName: 'Cow slippers', itemId: null, rawIds: ['1', '2', '3'], source: 'infobox_item' },
  ],
}

const emptyAllowlist: ItemAllowlist = { allowlistVersion: 1, entries: [] }

const options = {
  slug: 'test-boss',
  title: 'Test Boss',
  wikiRevId: 1,
  parserVersion: 1,
  itemIndex,
  allowlist: emptyAllowlist,
}

describe('assembleBoss', () => {
  it('builds a valid Boss document from an always-mode group', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'always',
        headings: ['100%'],
        denominator: null,
        ambiguous: null,
        entries: [
          {
            name: 'Bull bones',
            quantity: '1',
            noted: false,
            members: false,
            freeToPlay: false,
            rarity: { kind: 'always', num: 1, den: 1 },
            weight: null,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    expect(result.errors).toEqual([])
    expect(result.boss).not.toBeNull()
    expect(result.boss?.tables).toHaveLength(1)
    expect(result.boss?.tables[0]?.mode).toBe('always')
    const node = result.boss?.tables[0]?.entries[0]?.node
    expect(node && 'itemId' in node ? node.itemId : undefined).toBe(33115)
  })

  it('resolves an item to a null itemId and warns when the index does not resolve it', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Main'],
        denominator: 10,
        ambiguous: null,
        entries: [
          {
            name: 'Cow slippers',
            quantity: '1',
            noted: false,
            members: false,
            freeToPlay: false,
            rarity: { kind: 'fixed', num: 5, den: 10 },
            weight: 5,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    expect(result.boss).not.toBeNull()
    const node = result.boss?.tables[0]?.entries[0]?.node
    expect(node && 'itemId' in node ? node.itemId : undefined).toBeNull()
    expect(result.warnings.some((w) => w.includes('cow-slippers'))).toBe(true)
  })

  it('does not warn when the unresolved item is on the allowlist', () => {
    const allowlist: ItemAllowlist = {
      allowlistVersion: 1,
      entries: [{ itemKey: 'cow-slippers', title: 'Cow slippers', reason: 'multi-id' }],
    }
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Main'],
        denominator: 10,
        ambiguous: null,
        entries: [
          {
            name: 'Cow slippers',
            quantity: '1',
            noted: false,
            members: false,
            freeToPlay: false,
            rarity: { kind: 'fixed', num: 5, den: 10 },
            weight: 5,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, { ...options, allowlist })
    expect(result.warnings).toEqual([])
  })

  it('attaches a members condition and preserves noted', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Resources'],
        denominator: 10,
        ambiguous: null,
        entries: [
          {
            name: 'Bull bones',
            quantity: '3',
            noted: true,
            members: true,
            freeToPlay: false,
            rarity: { kind: 'fixed', num: 10, den: 10 },
            weight: 10,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    const entry = result.boss?.tables[0]?.entries[0]
    expect(entry?.conditions).toEqual([{ kind: 'members', value: true }])
    expect(entry?.node.kind === 'item' && entry.node.noted).toBe(true)
    expect(entry?.node.kind === 'item' && entry.node.qty).toEqual({ kind: 'exact', n: 3 })
  })

  it('parses a quantity range', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Other'],
        denominator: 10,
        ambiguous: null,
        entries: [
          {
            name: 'Bull bones',
            quantity: '60-80',
            noted: false,
            members: false,
            freeToPlay: true,
            rarity: { kind: 'fixed', num: 10, den: 10 },
            weight: 10,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    const entry = result.boss?.tables[0]?.entries[0]
    expect(entry?.node.kind === 'item' ? entry.node.qty : undefined).toEqual({
      kind: 'range',
      min: 60,
      max: 80,
    })
    expect(entry?.conditions).toEqual([{ kind: 'members', value: false }])
  })

  it('surfaces group-level ambiguity in ambiguousGroups without failing the parse', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'preroll',
        headings: ['Unique'],
        denominator: null,
        ambiguous: 'heterogeneous denominators, guessed preroll',
        entries: [
          {
            name: 'Bull bones',
            quantity: '1',
            noted: false,
            members: false,
            freeToPlay: false,
            rarity: { kind: 'fixed', num: 1, den: 196 },
            weight: null,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    expect(result.boss).not.toBeNull()
    expect(result.ambiguousGroups).toContain('heterogeneous denominators, guessed preroll')
    expect(result.warnings).toEqual([])
  })

  it('drops empty groups rather than emitting a table with zero entries', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Empty'],
        denominator: null,
        ambiguous: 'unparseable rarity',
        entries: [],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    expect(result.boss?.tables).toEqual([])
  })

  it('turns a resolved RDT access line into an independent tableRef table, with rolls and variant carried through', () => {
    const result = assembleBoss([], { lines: [
      { ref: 'rare_drop_table', rate: { num: 5, den: 150 }, rolls: 2, variant: 'Post-quest', approx: false, unmodelledMultiplier: null, raw: '{{RareDropTable|dropversion=Post-quest|5/150|rolls=2}}' },
    ], unresolved: [] }, options)
    expect(result.errors).toEqual([])
    expect(result.boss?.tables).toEqual([
      {
        id: 'test-boss:rdt-access:0',
        mode: 'independent',
        rolls: 2,
        withoutReplacement: false,
        entries: [
          {
            node: { kind: 'tableRef', ref: 'rare_drop_table' },
            rate: { kind: 'fixed', num: 5, den: 150 },
            conditions: [{ kind: 'variant', name: 'Post-quest' }],
          },
        ],
        notes: 'Access into rare_drop_table (from {{RareDropTable}})',
      },
    ])
  })

  it('surfaces an unresolved RDT access line as an ambiguous group and adds no table for it', () => {
    const result = assembleBoss(
      [],
      { lines: [], unresolved: [{ reason: 'references the God Wars Dungeon-variant table', raw: '{{GWDRDT}}' }] },
      options
    )
    expect(result.boss?.tables).toEqual([])
    expect(result.ambiguousGroups).toEqual([
      "RDT/gem-table access could not be modelled: references the God Wars Dungeon-variant table (raw: '{{GWDRDT}}')",
    ])
  })
})
