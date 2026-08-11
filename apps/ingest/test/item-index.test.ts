import { describe, expect, it, vi } from 'vitest'
import { buildItemIndex } from '../src/items/index.js'
import type { ItemIdRow, ItemNameRow, RequestRecord, WikiClient } from '../src/wiki/client.js'

vi.mock('../src/snapshots/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/snapshots/store.js')>()
  return { ...actual, writeSnapshot: vi.fn().mockResolvedValue('/dev/null') }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn().mockResolvedValue(undefined) }
})

const record: RequestRecord = { endpoint: '', params: {}, httpStatus: 200, body: {} }

function fakeClient(options: {
  namePages?: ItemNameRow[][]
  idPages?: ItemIdRow[][]
}): WikiClient {
  const namePages = options.namePages ?? []
  const idPages = options.idPages ?? []
  return {
    async itemNamePages(
      onPage: (rows: ItemNameRow[], record: RequestRecord, offset: number) => Promise<void>
    ) {
      let offset = 0
      for (const page of namePages) {
        await onPage(page, record, offset)
        offset += page.length
      }
      return offset
    },
    async itemIdPages(
      onPage: (rows: ItemIdRow[], record: RequestRecord, offset: number) => Promise<void>
    ) {
      let offset = 0
      for (const page of idPages) {
        await onPage(page, record, offset)
        offset += page.length
      }
      return offset
    },
  } as unknown as WikiClient
}

describe('buildItemIndex', () => {
  it('resolves a name with exactly one id row, from infobox_item', async () => {
    const client = fakeClient({
      namePages: [[{ pageName: 'Bull bones', itemName: 'Bull bones', ids: ['33115'] }]],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries).toEqual([
      { itemName: 'Bull bones', itemId: 33115, rawIds: ['33115'], source: 'infobox_item' },
    ])
  })

  it('resolves a dosed item by its exact item_name, not the shared base page', async () => {
    // Real shape: infobox_item has one row per dose, all sharing page_name
    // "Prayer potion" but each with its own item_name and item_id.
    const client = fakeClient({
      namePages: [
        [
          { pageName: 'Prayer potion', itemName: 'Prayer potion(1)', ids: ['143'] },
          { pageName: 'Prayer potion', itemName: 'Prayer potion(2)', ids: ['141'] },
          { pageName: 'Prayer potion', itemName: 'Prayer potion(3)', ids: ['139'] },
          { pageName: 'Prayer potion', itemName: 'Prayer potion(4)', ids: ['2434'] },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    const byName = new Map(index.entries.map((e) => [e.itemName, e]))
    expect(byName.get('Prayer potion(3)')?.itemId).toBe(139)
    expect(byName.get('Prayer potion(4)')?.itemId).toBe(2434)
  })

  it('aggregates a name split across multiple rows before deciding, rather than keeping only the last', async () => {
    // Real "Cow slippers" data: four infobox_item rows share item_name
    // "Cow slippers" (four genuinely distinct colour variants).
    const client = fakeClient({
      namePages: [
        [
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33093'] },
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33096'] },
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33097'] },
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33098'] },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toEqual({
      itemName: 'Cow slippers',
      itemId: null,
      rawIds: ['33093', '33096', '33097', '33098'],
      source: 'infobox_item',
    })
  })

  it('aggregates rows for the same name across different fetch pages', async () => {
    const client = fakeClient({
      namePages: [
        [{ pageName: 'Bottomless milk bucket', itemName: 'Bottomless milk bucket', ids: ['33089'] }],
        [{ pageName: 'Bottomless milk bucket', itemName: 'Bottomless milk bucket', ids: ['33091'] }],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.rawIds).toEqual(['33089', '33091'])
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('leaves a literal "N/A" id unresolved', async () => {
    const client = fakeClient({
      namePages: [[{ pageName: 'Clue scroll (easy)', itemName: 'Clue scroll (easy)', ids: ['N/A'] }]],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('prefers the one candidate with an unqualified page_name over special-mode reskins', async () => {
    // Real "Coins" shape: the base item plus three minigame reskins, all
    // rendering as item_name "Coins", distinguished only by page_name.
    const client = fakeClient({
      namePages: [
        [
          { pageName: 'Coins', itemName: 'Coins', ids: ['995'] },
          { pageName: 'Coins (Shilo Village)', itemName: 'Coins', ids: ['617'] },
          { pageName: 'Coins (Mage Training Arena)', itemName: 'Coins', ids: ['8890'] },
          { pageName: "Coins (My Arm's Big Adventure)", itemName: 'Coins', ids: ['6964'] },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]).toMatchObject({ itemName: 'Coins', itemId: 995 })
  })

  it('prefers the unqualified page for a dosed-potion collision with a restricted-mode variant', async () => {
    const client = fakeClient({
      namePages: [
        [
          { pageName: 'Prayer potion', itemName: 'Prayer potion(3)', ids: ['139'] },
          {
            pageName: 'Prayer potion (Last Man Standing)',
            itemName: 'Prayer potion(3)',
            ids: ['20394'],
          },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]).toMatchObject({ itemName: 'Prayer potion(3)', itemId: 139 })
  })

  it('stays unresolved when more than one candidate has an unqualified page_name (Cow slippers shape)', async () => {
    const client = fakeClient({
      namePages: [
        [
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33093'] },
          { pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33096'] },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('falls back to item_id for a name infobox_item has no row for', async () => {
    const client = fakeClient({
      namePages: [[{ pageName: 'Bull bones', itemName: 'Bull bones', ids: ['33115'] }]],
      idPages: [
        [
          { pageName: 'Bull bones', ids: ['33115'] },
          { pageName: 'Obscure quest item', ids: ['9999'] },
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    const byName = new Map(index.entries.map((e) => [e.itemName, e]))
    expect(byName.get('Bull bones')?.source).toBe('infobox_item')
    expect(byName.get('Obscure quest item')).toEqual({
      itemName: 'Obscure quest item',
      itemId: 9999,
      rawIds: ['9999'],
      source: 'item_id',
    })
  })
})
