import { describe, expect, it } from 'vitest'
import type { Table } from '@osrs-loot-simulator/loot-model'
import { assembleBoss } from '../src/parse/assemble-boss.js'
import { applyItemFlags, itemFlagsFor, type ItemFlags } from '../src/items/item-flags.js'
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
    { itemName: 'Bandos hilt', itemId: 11813, rawIds: ['11813'], source: 'infobox_item' },
    { itemName: 'Pet general graardor', itemId: 12650, rawIds: ['12650'], source: 'infobox_item' },
    { itemName: 'Big bones', itemId: 532, rawIds: ['532'], source: 'infobox_item' },
  ],
}

const emptyAllowlist: ItemAllowlist = { allowlistVersion: 1, entries: [] }

const options = {
  slug: 'general-graardor',
  title: 'General Graardor',
  wikiRevId: 1,
  parserVersion: 1,
  itemIndex,
  allowlist: emptyAllowlist,
  repeatable: true,
  aliases: [],
}

describe('itemFlagsFor', () => {
  const flags: ItemFlags = {
    itemFlagsVersion: 1,
    entries: [
      { bossSlug: 'general-graardor', itemKey: 'bandos-hilt', flags: ['unique'], reason: 'unique drop' },
      { bossSlug: 'general-graardor', itemKey: 'pet-general-graardor', flags: ['pet'], reason: 'the pet' },
    ],
  }

  it('returns the curated flags for a matching (bossSlug, itemKey) pair', () => {
    expect(itemFlagsFor(flags, 'general-graardor', 'bandos-hilt')).toEqual(new Set(['unique']))
    expect(itemFlagsFor(flags, 'general-graardor', 'pet-general-graardor')).toEqual(new Set(['pet']))
  })

  it('returns an empty set for an uncurated item or a curated item under the wrong boss', () => {
    expect(itemFlagsFor(flags, 'general-graardor', 'big-bones')).toEqual(new Set())
    expect(itemFlagsFor(flags, 'kree-arra', 'bandos-hilt')).toEqual(new Set())
  })
})

describe('assembleBoss item flags', () => {
  const groups: ParsedTableGroup[] = [
    {
      mode: 'weighted',
      headings: ['Main'],
      section: '',
      denominator: 10,
      ambiguous: null,
      entries: [
        {
          name: 'Bandos hilt',
          quantity: '1',
          noted: false,
          members: false,
          freeToPlay: false,
          rarity: { kind: 'fixed', num: 1, den: 10 },
          weight: 1,
        },
        {
          name: 'Pet general graardor',
          quantity: '1',
          noted: false,
          members: false,
          freeToPlay: false,
          rarity: { kind: 'fixed', num: 1, den: 10 },
          weight: 1,
        },
        {
          name: 'Big bones',
          quantity: '1',
          noted: false,
          members: false,
          freeToPlay: false,
          rarity: { kind: 'fixed', num: 8, den: 10 },
          weight: 8,
        },
      ],
    },
  ]

  it('sets unique/pet on the matching nodes and leaves the rest unset', () => {
    const itemFlags: ItemFlags = {
      itemFlagsVersion: 1,
      entries: [
        { bossSlug: 'general-graardor', itemKey: 'bandos-hilt', flags: ['unique'], reason: 'unique drop' },
        { bossSlug: 'general-graardor', itemKey: 'pet-general-graardor', flags: ['pet'], reason: 'the pet' },
      ],
    }
    const result = assembleBoss(groups, noRdtAccess, { ...options, itemFlags })
    expect(result.boss).not.toBeNull()
    const nodes = result.boss?.tables[0]?.entries.map((e) => e.node) ?? []

    const hilt = nodes.find((n) => n.kind === 'item' && n.itemKey === 'bandos-hilt')
    expect(hilt && 'unique' in hilt ? hilt.unique : undefined).toBe(true)
    expect(hilt && 'pet' in hilt ? hilt.pet : undefined).toBeUndefined()

    const pet = nodes.find((n) => n.kind === 'item' && n.itemKey === 'pet-general-graardor')
    expect(pet && 'pet' in pet ? pet.pet : undefined).toBe(true)
    expect(pet && 'unique' in pet ? pet.unique : undefined).toBeUndefined()

    const bones = nodes.find((n) => n.kind === 'item' && n.itemKey === 'big-bones')
    expect(bones && 'unique' in bones ? bones.unique : undefined).toBeUndefined()
    expect(bones && 'pet' in bones ? bones.pet : undefined).toBeUndefined()
  })

  it('leaves every node unset when no flags are curated for this boss', () => {
    const emptyItemFlags: ItemFlags = { itemFlagsVersion: 1, entries: [] }
    const result = assembleBoss(groups, noRdtAccess, { ...options, itemFlags: emptyItemFlags })
    const nodes = result.boss?.tables[0]?.entries.map((e) => e.node) ?? []
    for (const node of nodes) {
      expect(node.kind === 'item' && 'unique' in node ? node.unique : undefined).toBeUndefined()
      expect(node.kind === 'item' && 'pet' in node ? node.pet : undefined).toBeUndefined()
    }
  })
})

describe('applyItemFlags', () => {
  // The bug this guards: a hand-authored `data/overrides/*.json` `tables`
  // array (e.g. Doom of Mokhaiotl's) never passes through `assembleBoss`'s
  // own item-node construction — `applyOverride` replaces tables wholesale.
  // Without a SECOND, general stamping pass over the boss's final tables,
  // every override boss whose author didn't hand-inline `unique`/`pet` into
  // the override JSON itself silently ships with no curated flags at all,
  // which is exactly what left Doom of Mokhaiotl showing no uniques in the
  // UI despite `data/item-flags.json` correctly curating three of them.
  const flags: ItemFlags = {
    itemFlagsVersion: 1,
    entries: [
      { bossSlug: 'doom-of-mokhaiotl', itemKey: 'avernic-treads', flags: ['unique'], reason: 'unique drop' },
      { bossSlug: 'doom-of-mokhaiotl', itemKey: 'dom', flags: ['pet'], reason: 'the pet' },
    ],
  }

  // Shaped like a hand-authored override's `tables` — an item node built
  // directly, never touched by `assembleBoss`.
  const overrideTables: Table[] = [
    {
      id: 'doom:delve-4',
      mode: 'independent',
      rolls: 1,
      withoutReplacement: false,
      entries: [
        {
          node: {
            kind: 'item',
            itemId: 1,
            itemKey: 'avernic-treads',
            name: 'Avernic treads',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 1000 },
        },
        {
          node: {
            kind: 'item',
            itemId: 2,
            itemKey: 'dom',
            name: 'Dom',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 3000 },
        },
        {
          node: {
            kind: 'item',
            itemId: 3,
            itemKey: 'demon-tear',
            name: 'Demon tear',
            qty: { kind: 'exact', n: 50 },
          },
          rate: { kind: 'always' },
        },
      ],
    },
  ]

  it('stamps unique/pet onto override-authored item nodes assembleBoss never touched', () => {
    const stamped = applyItemFlags(overrideTables, flags, 'doom-of-mokhaiotl')
    const nodes = stamped[0]!.entries.map((e) => e.node)

    const treads = nodes.find((n) => n.kind === 'item' && n.itemKey === 'avernic-treads')
    expect(treads?.kind === 'item' ? treads.unique : undefined).toBe(true)

    const pet = nodes.find((n) => n.kind === 'item' && n.itemKey === 'dom')
    expect(pet?.kind === 'item' ? pet.pet : undefined).toBe(true)

    const tear = nodes.find((n) => n.kind === 'item' && n.itemKey === 'demon-tear')
    expect(tear?.kind === 'item' ? tear.unique : undefined).toBeUndefined()
    expect(tear?.kind === 'item' ? tear.pet : undefined).toBeUndefined()
  })

  it('is a no-op for a boss with no curated entries', () => {
    const emptyFlags: ItemFlags = { itemFlagsVersion: 1, entries: [] }
    const stamped = applyItemFlags(overrideTables, emptyFlags, 'doom-of-mokhaiotl')
    for (const entry of stamped[0]!.entries) {
      expect(entry.node.kind === 'item' ? entry.node.unique : undefined).toBeUndefined()
      expect(entry.node.kind === 'item' ? entry.node.pet : undefined).toBeUndefined()
    }
  })
})
