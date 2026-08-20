import { describe, expect, it } from 'vitest'
import { assembleBoss } from '../src/parse/assemble-boss.js'
import type { ItemAllowlist } from '../src/items/allowlist.js'
import type { ItemFlags } from '../src/items/item-flags.js'
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
const emptyItemFlags: ItemFlags = { itemFlagsVersion: 1, entries: [] }

const options = {
  slug: 'test-boss',
  title: 'Test Boss',
  wikiRevId: 1,
  parserVersion: 1,
  itemIndex,
  allowlist: emptyAllowlist,
  itemFlags: emptyItemFlags,
  repeatable: true,
  aliases: [],
}

describe('assembleBoss', () => {
  it('builds a valid Boss document from an always-mode group', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'always',
        headings: ['100%'],
        section: '',
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

  it('carries a many-to-one source\'s common name through as an alias', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'always',
        headings: ['100%'],
        section: '',
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
    // e.g. `title: 'Ancient chest'` (the wiki drops page) alongside the loot
    // source's real name, "Chambers of Xeric" — see `main.ts`'s `aliases`.
    const result = assembleBoss(groups, noRdtAccess, { ...options, aliases: ['Chambers of Xeric'] })
    expect(result.boss?.name).toBe('Test Boss')
    expect(result.boss?.aliases).toEqual(['Chambers of Xeric'])
  })

  it('resolves an item to a null itemId and warns when the index does not resolve it', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Main'],
        section: '',
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
        section: '',
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
        section: '',
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
        section: '',
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

  it('parses a comma-separated quantity range (DT2\'s resource tables) rather than concatenating it', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'weighted',
        headings: ['Resources'],
        section: '',
        denominator: 100,
        ambiguous: null,
        entries: [
          {
            name: 'Aether catalyst',
            quantity: '1500,2250',
            noted: false,
            members: false,
            freeToPlay: false,
            rarity: { kind: 'fixed', num: 1, den: 100 },
            weight: 1,
          },
        ],
      },
    ]
    const result = assembleBoss(groups, noRdtAccess, options)
    const entry = result.boss?.tables[0]?.entries[0]
    // Not `{ kind: 'exact', n: 15002250 }` — the pre-fix bug, stripping the
    // comma and concatenating the two numbers into one.
    expect(entry?.node.kind === 'item' ? entry.node.qty : undefined).toEqual({
      kind: 'range',
      min: 1500,
      max: 2250,
    })
  })

  it('surfaces group-level ambiguity in ambiguousGroups without failing the parse', () => {
    const groups: ParsedTableGroup[] = [
      {
        mode: 'preroll',
        headings: ['Unique'],
        section: '',
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
        section: '',
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
      { ref: 'rare_drop_table', rate: { num: 5, den: 150 }, rolls: 2, variant: 'Post-quest', approx: false, qtyMultiplier: null, drawsPerHit: null, raw: '{{RareDropTable|dropversion=Post-quest|5/150|rolls=2}}' },
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

  /**
   * Obor/Bryophyta's shape: a section-level members/F2P split with no
   * per-row `{{(m)}}`/`{{(f)}}` marker at all — see `conditionsFor`'s comment.
   */
  describe('section-level membership fallback', () => {
    it("attaches members:true from a 'Members' worlds drops' section, unmarked at the row level", () => {
      const groups: ParsedTableGroup[] = [
        {
          mode: 'always',
          headings: ['100%'],
          section: "Members' worlds drops",
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
      expect(result.boss?.tables[0]?.entries[0]?.conditions).toEqual([{ kind: 'members', value: true }])
    })

    it("attaches members:false from a 'Free-to-play worlds drops' section", () => {
      const groups: ParsedTableGroup[] = [
        {
          mode: 'always',
          headings: ['100%'],
          section: 'Free-to-play worlds drops',
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
      expect(result.boss?.tables[0]?.entries[0]?.conditions).toEqual([{ kind: 'members', value: false }])
    })

    it('lets a per-row marker override the section fallback', () => {
      const groups: ParsedTableGroup[] = [
        {
          mode: 'always',
          headings: ['100%'],
          section: "Members' worlds drops",
          denominator: null,
          ambiguous: null,
          entries: [
            {
              name: 'Bull bones',
              quantity: '1',
              noted: false,
              members: false,
              freeToPlay: true, // an (f) marker inside a Members-only section
              rarity: { kind: 'always', num: 1, den: 1 },
              weight: null,
            },
          ],
        },
      ]
      const result = assembleBoss(groups, noRdtAccess, options)
      // The row's own marker wins, not the enclosing section.
      expect(result.boss?.tables[0]?.entries[0]?.conditions).toEqual([{ kind: 'members', value: false }])
    })

    it('does not fire on an unrelated section title', () => {
      const groups: ParsedTableGroup[] = [
        {
          mode: 'always',
          headings: ['100%'],
          section: 'Elite drops',
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
      expect(result.boss?.tables[0]?.entries[0]?.conditions).toBeUndefined()
    })
  })

  /**
   * A confirmed co-drop bundle (`build-tables.ts`'s `findBundleGroups`)
   * arrives here as one `ParsedEntry` carrying `.bundle` instead of a real
   * item name. `assembleBoss` is what turns that into the actual schema
   * shape: a `tableRef` node in the boss's own table, plus a new
   * `mode: 'always'` shared table in `AssembleResult.bundleTables` — the
   * `tableRef`/`always`-mode primitives docs/DECISIONS.md's "bundle shape,
   * assessed" entry confirmed need zero schema change.
   */
  describe('bundle entries', () => {
    const bundleGroup: ParsedTableGroup = {
      mode: 'weighted',
      headings: ['Supplies'],
      section: '',
      denominator: 142,
      ambiguous: null,
      entries: [
        {
          name: '<bundle: Magic potion(2) + Ranging potion(2)>',
          quantity: '1',
          noted: false,
          members: false,
          freeToPlay: false,
          rarity: { kind: 'fixed', num: 6, den: 142 },
          weight: 6,
          bundle: {
            heading: 'Supplies',
            members: [
              { name: 'Bull bones', quantity: '2', noted: false },
              { name: 'Cow slippers', quantity: '1', noted: true },
            ],
            signal: "footnote 'pots' says \"dropped together\"",
          },
        },
      ],
    }

    it('builds a tableRef node instead of resolving the bundle as an item', () => {
      const result = assembleBoss([bundleGroup], noRdtAccess, options)
      expect(result.errors).toEqual([])
      const node = result.boss?.tables[0]?.entries[0]?.node
      expect(node).toEqual({ kind: 'tableRef', ref: 'test-boss-supplies-bundle' })
      // The bundle's own weight (the shared access rate, not a per-item share)
      // survives untouched — collapsing N rows to one doesn't change how the
      // ENTRY into the bundle is rolled, only what's inside it.
      expect(result.boss?.tables[0]?.entries[0]?.rate).toEqual({ kind: 'weight', weight: 6 })
    })

    it('returns one always-mode shared table with an item entry per bundled member', () => {
      const result = assembleBoss([bundleGroup], noRdtAccess, options)
      expect(result.bundleTables).toHaveLength(1)
      const table = result.bundleTables[0]!
      expect(table.id).toBe('test-boss-supplies-bundle')
      expect(table.mode).toBe('always')
      expect(table.entries).toHaveLength(2)
      expect(table.entries.every((e) => e.rate.kind === 'always')).toBe(true)
      const node0 = table.entries[0]?.node
      expect(node0 && 'itemId' in node0 ? node0.itemId : undefined).toBe(33115)
      const node1 = table.entries[1]?.node
      expect(node1 && 'name' in node1 ? node1.name : undefined).toBe('Cow slippers')
      expect(node1 && 'noted' in node1 ? node1.noted : undefined).toBe(true)
    })

    it('numbers a second bundle under the same heading rather than colliding', () => {
      const secondBundle: ParsedTableGroup = {
        ...bundleGroup,
        entries: [
          {
            ...bundleGroup.entries[0]!,
            bundle: {
              heading: 'Supplies',
              members: [{ name: 'Bull bones', quantity: '1', noted: false }],
              signal: "footnote 'other' says \"dropped together\"",
            },
          },
        ],
      }
      const result = assembleBoss([bundleGroup, secondBundle], noRdtAccess, options)
      expect(result.bundleTables.map((t) => t.id)).toEqual([
        'test-boss-supplies-bundle',
        'test-boss-supplies-bundle-2',
      ])
    })
  })
})
