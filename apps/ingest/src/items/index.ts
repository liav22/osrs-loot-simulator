import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ItemIdRow, ItemNameRow, WikiClient } from '../wiki/client.js'
import { REPO_ROOT, slugify, writeSnapshot } from '../snapshots/store.js'

/**
 * The item index: exact item display name -> resolved item id (or `null`
 * when the name does not resolve to exactly one).
 *
 * Built primarily from `bucket('infobox_item')`, which has one row per item
 * VERSION with an `item_name` field carrying the exact display name a
 * `{{DropsLine|name=...}}` value uses — e.g. "Prayer potion(3)", distinct
 * from `item_id`'s `page_name` of "Prayer potion" (the base page all four
 * doses share). Resolving by `item_id`'s page name alone collapses every
 * dosed/charged item's versions onto one page and cannot recover which id is
 * which name; `infobox_item` already carries that distinction per row.
 * `bucket('item_id')` still fills in any name `infobox_item` has no row for.
 *
 * Written to `data/_item-index.json` — under `data/`, so CC BY-NC-SA like the
 * rest of the wiki-derived corpus.
 */

export const ItemIndexEntrySchema = z
  .object({
    itemName: z.string().min(1),
    /** Null when `rawIds` did not contain exactly one parseable integer. */
    itemId: z.number().int().nonnegative().nullable(),
    /** Raw ids as the bucket returned them, for auditing an unresolved entry. */
    rawIds: z.array(z.string()),
    /** Which bucket resolved this name — `infobox_item` is preferred. */
    source: z.enum(['infobox_item', 'item_id']),
  })
  .strict()

export type ItemIndexEntry = z.infer<typeof ItemIndexEntrySchema>

export const ItemIndexSchema = z
  .object({
    itemIndexVersion: z.literal(2),
    generatedAt: z.string(),
    rowCount: z.number().int().nonnegative(),
    entries: z.array(ItemIndexEntrySchema),
  })
  .strict()

export type ItemIndex = z.infer<typeof ItemIndexSchema>

export const ITEM_INDEX_PATH = join(REPO_ROOT, 'data', '_item-index.json')

function toId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

function resolveId(ids: readonly string[]): number | null {
  if (ids.length !== 1) return null
  return toId(ids[0])
}

/**
 * `item_name` collides across unrelated pages more often than it is unique:
 * "Coins" is one row from the base game (`page_name` "Coins", id 995) plus
 * three from minigame reskins (`page_name`s like "Coins (Shilo Village)"),
 * and "Prayer potion(3)" collides with its Last Man Standing-restricted
 * counterpart. In every such case observed, the standard item's `page_name`
 * carries no parenthetical qualifier while every special-mode variant's does
 * — so when a name resolves to more than one id, the candidate whose
 * `page_name` has no "(" is preferred, PROVIDED it is the only one shaped
 * that way. A genuinely ambiguous item like "Cow slippers" (four real colour
 * variants, all with the plain, unqualified `page_name` "Cow slippers") has
 * more than one such candidate and is correctly left unresolved rather than
 * guessed at.
 */
function resolveWithUnqualifiedPagePreference(
  rows: readonly { pageName: string; id: string }[]
): number | null {
  const ids = rows.map((row) => row.id)
  const direct = resolveId(ids)
  if (direct !== null) return direct

  const unqualified = rows.filter((row) => !row.pageName.includes('('))
  if (unqualified.length !== 1) return null
  return toId(unqualified[0]?.id)
}

/**
 * Both buckets emit one ROW PER ID for a name with several — e.g. "Cow
 * slippers" is four separate `infobox_item` rows sharing `item_name`, each
 * with a single-element `item_id`. A naive name-keyed map would silently keep
 * only the last row; every row for a name must be collected before deciding
 * whether it resolves.
 */
export async function buildItemIndex(
  client: WikiClient,
  log: (message: string) => void
): Promise<ItemIndex> {
  const rowsByName = new Map<string, { pageName: string; id: string }[]>()

  log("Reading bucket('infobox_item') — item_name is what DropsLine's name= matches")
  const nameTotal = await client.itemNamePages(async (rows: ItemNameRow[], record, offset) => {
    await writeSnapshot('item-id', `name-offset-${offset}`, record)
    for (const row of rows) {
      const existing = rowsByName.get(row.itemName) ?? []
      for (const id of row.ids) existing.push({ pageName: row.pageName, id })
      rowsByName.set(row.itemName, existing)
    }
    log(`  offset ${offset}: ${rows.length} rows`)
  })
  const namesFromInfobox = new Set(rowsByName.keys())

  log("\nReading bucket('item_id') as a fallback for names infobox_item has no row for")
  const rawIdsByPageIfMissing = new Map<string, string[]>()
  const idTotal = await client.itemIdPages(async (rows: ItemIdRow[], record, offset) => {
    await writeSnapshot('item-id', `offset-${offset}`, record)
    for (const row of rows) {
      if (namesFromInfobox.has(row.pageName)) continue
      const existing = rawIdsByPageIfMissing.get(row.pageName) ?? []
      existing.push(...row.ids)
      rawIdsByPageIfMissing.set(row.pageName, existing)
    }
    log(`  offset ${offset}: ${rows.length} rows`)
  })

  const entries: ItemIndexEntry[] = [
    ...[...rowsByName.entries()].map(([itemName, rows]) => ({
      itemName,
      itemId: resolveWithUnqualifiedPagePreference(rows),
      rawIds: rows.map((row) => row.id),
      source: 'infobox_item' as const,
    })),
    ...[...rawIdsByPageIfMissing.entries()].map(([itemName, rawIds]) => ({
      itemName,
      itemId: resolveId(rawIds),
      rawIds,
      source: 'item_id' as const,
    })),
  ]

  const index = ItemIndexSchema.parse({
    itemIndexVersion: 2,
    generatedAt: new Date().toISOString(),
    rowCount: nameTotal + idTotal,
    entries,
  })
  await writeFile(ITEM_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return index
}

export async function readItemIndex(path = ITEM_INDEX_PATH): Promise<ItemIndex> {
  return ItemIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

/**
 * Exact item name -> entry, for O(1) lookup during parsing. `itemKey` in the
 * loot model is `slugify(name)` of the `{{DropsLine}}` display name, so this
 * is keyed the same way.
 */
export function indexByItemKey(index: ItemIndex): Map<string, ItemIndexEntry> {
  const byKey = new Map<string, ItemIndexEntry>()
  for (const entry of index.entries) byKey.set(slugify(entry.itemName), entry)
  return byKey
}
