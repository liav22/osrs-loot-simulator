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

/** `defaultVersion` defaults to `false` — only the tests exercising it need to set it. */
function nameRow(overrides: Partial<ItemNameRow> & Pick<ItemNameRow, 'pageName' | 'itemName' | 'ids'>): ItemNameRow {
  return { defaultVersion: false, ...overrides }
}

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
      namePages: [[nameRow({ pageName: 'Bull bones', itemName: 'Bull bones', ids: ['33115'] })]],
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
          nameRow({ pageName: 'Prayer potion', itemName: 'Prayer potion(1)', ids: ['143'] }),
          nameRow({ pageName: 'Prayer potion', itemName: 'Prayer potion(2)', ids: ['141'] }),
          nameRow({ pageName: 'Prayer potion', itemName: 'Prayer potion(3)', ids: ['139'] }),
          nameRow({ pageName: 'Prayer potion', itemName: 'Prayer potion(4)', ids: ['2434'] }),
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    const byName = new Map(index.entries.map((e) => [e.itemName, e]))
    expect(byName.get('Prayer potion(3)')?.itemId).toBe(139)
    expect(byName.get('Prayer potion(4)')?.itemId).toBe(2434)
  })

  it('aggregates a name split across multiple rows before deciding, rather than keeping only the last', async () => {
    // Real "Cow slippers" data (pre-default_version investigation): four
    // infobox_item rows share item_name "Cow slippers", none marked
    // default_version, so all four stay candidates.
    const client = fakeClient({
      namePages: [
        [
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33093'] }),
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33096'] }),
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33097'] }),
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33098'] }),
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
        [nameRow({ pageName: 'Bottomless milk bucket', itemName: 'Bottomless milk bucket', ids: ['33089'] })],
        [nameRow({ pageName: 'Bottomless milk bucket', itemName: 'Bottomless milk bucket', ids: ['33091'] })],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.rawIds).toEqual(['33089', '33091'])
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('leaves a literal "N/A" id unresolved', async () => {
    const client = fakeClient({
      namePages: [[nameRow({ pageName: 'Clue scroll (easy)', itemName: 'Clue scroll (easy)', ids: ['N/A'] })]],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('prefers the one candidate with an unqualified page_name over special-mode reskins', async () => {
    // Real "Coins" shape: the base item plus three minigame reskins, all
    // rendering as item_name "Coins", distinguished only by page_name —
    // default_version is unset on all four (checked directly against the
    // live wiki), so this must still resolve via the page-name signal alone.
    const client = fakeClient({
      namePages: [
        [
          nameRow({ pageName: 'Coins', itemName: 'Coins', ids: ['995'] }),
          nameRow({ pageName: 'Coins (Shilo Village)', itemName: 'Coins', ids: ['617'] }),
          nameRow({ pageName: 'Coins (Mage Training Arena)', itemName: 'Coins', ids: ['8890'] }),
          nameRow({ pageName: "Coins (My Arm's Big Adventure)", itemName: 'Coins', ids: ['6964'] }),
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
          nameRow({ pageName: 'Prayer potion', itemName: 'Prayer potion(3)', ids: ['139'] }),
          nameRow({
            pageName: 'Prayer potion (Last Man Standing)',
            itemName: 'Prayer potion(3)',
            ids: ['20394'],
          }),
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]).toMatchObject({ itemName: 'Prayer potion(3)', itemId: 139 })
  })

  it('stays unresolved when more than one candidate has an unqualified page_name and neither is the default version', async () => {
    const client = fakeClient({
      namePages: [
        [
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33093'] }),
          nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33096'] }),
        ],
      ],
    })
    const index = await buildItemIndex(client, () => undefined)
    expect(index.entries[0]?.itemId).toBeNull()
  })

  it('falls back to item_id for a name infobox_item has no row for', async () => {
    const client = fakeClient({
      namePages: [[nameRow({ pageName: 'Bull bones', itemName: 'Bull bones', ids: ['33115'] })]],
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

  describe('default_version disambiguation', () => {
    it('resolves a multi-version collision via the one candidate marked default_version (Troll bone shape)', async () => {
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Troll bone', itemName: 'Troll bone', ids: ['7884'], defaultVersion: true }),
            nameRow({ pageName: 'Troll bone', itemName: 'Troll bone', ids: ['7886'], defaultVersion: false }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemName: 'Troll bone', itemId: 7884 })
    })

    it('resolves a real four-way colour collision now that default_version is read (Cow slippers shape)', async () => {
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33093'], defaultVersion: true }),
            nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33096'] }),
            nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33097'] }),
            nameRow({ pageName: 'Cow slippers', itemName: 'Cow slippers', ids: ['33098'] }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemName: 'Cow slippers', itemId: 33093 })
    })

    it('applies default_version THEN unqualified-page-name when a name collides both ways at once (Eclipse moon helm shape)', async () => {
      // Real shape: three candidates. "Used" is not default. "New" (plain
      // page) AND the Last Man Standing reskin are BOTH marked default on
      // their own pages — default_version alone leaves two; the unqualified
      // page-name step is what finally tells them apart.
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Eclipse moon helm', itemName: 'Eclipse moon helm', ids: ['29035'], defaultVersion: false }),
            nameRow({ pageName: 'Eclipse moon helm', itemName: 'Eclipse moon helm', ids: ['29010'], defaultVersion: true }),
            nameRow({
              pageName: 'Eclipse moon helm (Last Man Standing)',
              itemName: 'Eclipse moon helm',
              ids: ['29842'],
              defaultVersion: true,
            }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemName: 'Eclipse moon helm', itemId: 29010 })
    })

    it('stays unresolved when a single row legitimately carries many interchangeable ids (Key (medium) shape)', async () => {
      // Real shape: ALL eleven clue-key ids live on ONE infobox_item row,
      // trivially its own single default_version candidate — neither
      // disambiguation step narrows an 11-element id list to one, and this
      // is not supposed to resolve here; it belongs on the multi-id
      // allowlist, the same way clue scroll tiers already are.
      const client = fakeClient({
        namePages: [
          [
            nameRow({
              pageName: 'Key (Treasure Trails)',
              itemName: 'Key (medium)',
              ids: ['2832', '2834', '2836', '2838', '2840', '3606', '3608', '7297', '7299', '7302', '19761'],
              defaultVersion: true,
            }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]?.itemId).toBeNull()
      expect(index.entries[0]?.rawIds).toHaveLength(11)
    })

    it('does not narrow at all when default_version is unset everywhere (Coins shape, defence in depth)', async () => {
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Coins', itemName: 'Coins', ids: ['995'] }),
            nameRow({ pageName: 'Coins (Shilo Village)', itemName: 'Coins', ids: ['617'] }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemId: 995 })
    })

    it('does not mistake a base name that itself contains parentheses for a qualified variant (Diamond bolts (e) shape)', async () => {
      // Real shape: BOTH candidates are marked default_version=true on their
      // own pages, so step 1 doesn't narrow at all. A naive
      // `pageName.includes('(')` check (the original implementation) would
      // ALSO flag the base item as "qualified" — its own name is "Diamond
      // bolts (e)" — leaving both candidates indistinguishable. The fix
      // checks whether one page name is literally the other's name plus a
      // trailing parenthetical, not just "contains a paren anywhere."
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Diamond bolts (e)', itemName: 'Diamond bolts (e)', ids: ['9243'], defaultVersion: true }),
            nameRow({
              pageName: 'Diamond bolts (e) (Last Man Standing)',
              itemName: 'Diamond bolts (e)',
              ids: ['23649'],
              defaultVersion: true,
            }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemName: 'Diamond bolts (e)', itemId: 9243 })
    })

    it('prefers the candidate whose own page_name exactly matches the item name (Feather / Wimpy feather shape)', async () => {
      // Real shape: two candidates on two UNRELATED pages (neither name is
      // a qualified variant of the other, so step 2 can't help) that happen
      // to render the same display text. "Wimpy feather"'s own item_name is
      // just "Feather", colliding with the plain "Feather" page.
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Feather', itemName: 'Feather', ids: ['314'], defaultVersion: true }),
            nameRow({ pageName: 'Wimpy feather', itemName: 'Feather', ids: ['11525'], defaultVersion: true }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]).toMatchObject({ itemName: 'Feather', itemId: 314 })
    })

    it('stays unresolved when even an exact page-name match does not narrow to one', async () => {
      const client = fakeClient({
        namePages: [
          [
            nameRow({ pageName: 'Widget', itemName: 'Widget', ids: ['1'], defaultVersion: true }),
            nameRow({ pageName: 'Widget', itemName: 'Widget', ids: ['2'], defaultVersion: true }),
          ],
        ],
      })
      const index = await buildItemIndex(client, () => undefined)
      expect(index.entries[0]?.itemId).toBeNull()
    })
  })
})
