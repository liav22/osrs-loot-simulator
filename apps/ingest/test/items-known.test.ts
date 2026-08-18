import { describe, expect, it } from 'vitest'
import { checkItemsKnown, type ItemCheckInput } from '../src/validate/items-known.js'
import { isAllowlisted, type ItemAllowlist } from '../src/items/allowlist.js'
import { indexByItemKey, type ItemIndex } from '../src/items/index.js'

const index: ItemIndex = {
  itemIndexVersion: 2,
  generatedAt: '2026-08-11T00:00:00.000Z',
  rowCount: 3,
  entries: [
    { itemName: 'Bull bones', itemId: 33115, rawIds: ['33115'], source: 'infobox_item' },
    { itemName: 'Coins', itemId: 995, rawIds: ['995'], source: 'infobox_item' },
    { itemName: 'Clue scroll (easy)', itemId: null, rawIds: ['N/A'], source: 'infobox_item' },
  ],
}

const allowlist: ItemAllowlist = {
  allowlistVersion: 1,
  entries: [
    { itemKey: 'clue-scroll-easy', title: 'Clue scroll (easy)', reason: 'many ids, one page' },
  ],
}

describe('indexByItemKey', () => {
  it('keys by the slugified page name', () => {
    const byKey = indexByItemKey(index)
    expect(byKey.get('bull-bones')?.itemId).toBe(33115)
    expect(byKey.get('coins')?.itemId).toBe(995)
  })
})

describe('isAllowlisted', () => {
  it('matches by itemKey', () => {
    expect(isAllowlisted(allowlist, 'clue-scroll-easy')).toBe(true)
    expect(isAllowlisted(allowlist, 'bull-bones')).toBe(false)
  })
})

describe('checkItemsKnown', () => {
  const passing: ItemCheckInput[] = [
    { itemKey: 'bull-bones', itemId: 33115 },
    { itemKey: 'coins', itemId: 995 },
  ]

  it('passes when every item resolves to the index id', () => {
    const result = checkItemsKnown(passing, index, allowlist)
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('passes an unresolved item that is on the allowlist', () => {
    const result = checkItemsKnown(
      [...passing, { itemKey: 'clue-scroll-easy', itemId: null }],
      index,
      allowlist
    )
    expect(result.ok).toBe(true)
  })

  it('fails an item key absent from both the index and the allowlist', () => {
    const result = checkItemsKnown([{ itemKey: 'mystery-item', itemId: 1 }], index, allowlist)
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.reason).toMatch(/not in the item index/)
  })

  it('fails an item key that resolves to null in the index and is not allowlisted', () => {
    const result = checkItemsKnown(
      [{ itemKey: 'clue-scroll-easy', itemId: null }],
      index,
      { allowlistVersion: 1, entries: [] }
    )
    expect(result.ok).toBe(false)
    expect(result.failures[0]?.reason).toMatch(/does not resolve to a single item id/)
  })

  it('fails when the node itemId disagrees with the index', () => {
    const result = checkItemsKnown([{ itemKey: 'bull-bones', itemId: 1 }], index, allowlist)
    expect(result.ok).toBe(false)
    expect(result.failures[0]?.reason).toMatch(/resolves 'bull-bones' to 33115/)
  })

  it('passes the "nothing" sentinel (a literal wiki "Nothing" drop row) with no index/allowlist entry needed', () => {
    // Black Knight Titan, Obor, Salarin the twisted all write a literal
    // "Nothing" drop row — not an unresolved real item, so it must not need
    // an item-index entry or an allowlist exception the way a genuine
    // unresolved item would. Mirrors drops-covered.ts's own NOT_ITEM_NODES
    // carve-out for the same sentinel.
    const result = checkItemsKnown(
      [...passing, { itemKey: 'nothing', itemId: null }],
      index,
      allowlist
    )
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('does NOT exempt an itemKey of "nothing" carrying a non-null itemId', () => {
    // The exemption is narrowly for the sentinel shape (itemId: null); a
    // node that happens to be keyed 'nothing' but carries a real id is not
    // the sentinel and must still resolve normally.
    const result = checkItemsKnown([{ itemKey: 'nothing', itemId: 1 }], index, allowlist)
    expect(result.ok).toBe(false)
  })

  it('never treats a real itemId of 0 as unresolved', () => {
    const zeroIndex: ItemIndex = {
      ...index,
      entries: [
        ...index.entries,
        { itemName: 'Zero item', itemId: 0, rawIds: ['0'], source: 'infobox_item' },
      ],
    }
    const result = checkItemsKnown([{ itemKey: 'zero-item', itemId: 0 }], zeroIndex, allowlist)
    expect(result.ok).toBe(true)
  })
})
