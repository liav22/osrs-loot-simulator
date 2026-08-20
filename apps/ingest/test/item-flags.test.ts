import { describe, expect, it } from 'vitest'
import { assembleBoss } from '../src/parse/assemble-boss.js'
import { itemFlagsFor, type ItemFlags } from '../src/items/item-flags.js'
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
