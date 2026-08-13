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

interface CandidateRow {
  pageName: string
  id: string
  /** `{{Infobox Item|...|default_version=yes}}` on this row's own version. */
  defaultVersion: boolean
}

/**
 * `pageName` is a "qualified variant of" `basePageName` when it's exactly
 * that name plus a trailing parenthetical — "Diamond bolts (e) (Last Man
 * Standing)" relative to "Diamond bolts (e)". A plain `pageName.includes('(')`
 * check is NOT the same thing and misfires on any item whose own base name
 * already contains one (every "(e)"-enchanted bolt/dart, "(t)"-trimmed
 * item, etc.) — confirmed the hard way: "Diamond bolts (e)" itself contains
 * "(", so the naive check flagged the base item as "qualified" too and left
 * it indistinguishable from its own Last Man Standing reskin.
 */
function isQualifiedVariantOf(pageName: string, basePageName: string): boolean {
  return pageName.startsWith(`${basePageName} (`) && pageName.endsWith(')')
}

/**
 * A name can collide structurally different ways, and this resolves them —
 * in order, each step narrowing the candidate set, never guessing:
 *
 *   1. Collision WITHIN one page's multi-version infobox — dose/charge/
 *      legacy/colour variants of what is conceptually one item (Troll
 *      bone's Unpolished/Polished, Callisto cub's Normal/Legacy, Cow
 *      slippers' four colours). The wiki marks exactly one version
 *      `default_version=yes` on pages that need this at all; when exactly
 *      one candidate carries it, that settles it.
 *   2. Collision ACROSS unrelated pages that happen to render the same
 *      display text via a NAMED reskin — "Coins" (base game) vs "Coins
 *      (Shilo Village)"; "Diamond bolts (e)" vs its Last Man Standing
 *      counterpart. Every special-mode variant's `page_name` is the
 *      standard item's own page name plus a trailing parenthetical
 *      (`isQualifiedVariantOf`); when exactly one candidate is not a
 *      qualified variant of any other, that's the one.
 *   3. Collision ACROSS unrelated pages with UNRELATED names that merely
 *      render the same display text — "Feather" (id 314, the common
 *      Fletching/Slayer supply) and "Wimpy feather" (id 11525, a joke item
 *      whose own `item_name` is ALSO plain "Feather") both exist as
 *      candidates for the name "Feather", and neither is a `pageName`-
 *      qualified variant of the other, so step 2 can't tell them apart. The
 *      candidate whose OWN `page_name` exactly equals the name being
 *      resolved is preferred when it's the only one shaped that way.
 *
 * Every signal applies in sequence, because some names need more than one:
 * Eclipse moon helm has three candidates — "Used" (not default), "New"
 * (default, plain page), and an LMS reskin (ALSO marked default, on its own
 * qualified page). Step 1 alone leaves two candidates (New and the LMS
 * reskin, both `default_version=yes`); step 2 then tells them apart. A step
 * that matches nothing, or narrows to more than one, is skipped rather than
 * treated as a resolution — `default_version` was found unpopulated for
 * every candidate the first time this was checked (Coins), and step 2 alone
 * still has to carry that case. Returns `null` when more than one candidate
 * survives every step — "Key (medium)" collapses eleven interchangeable
 * clue-key ids onto ONE row that is trivially its own single
 * `default_version` candidate, so nothing here narrows an 11-element id
 * list to one; it stays unresolved and belongs on the multi-id allowlist
 * instead, the same way clue scroll tiers already are.
 */
function resolveWithDisambiguation(itemName: string, rows: readonly CandidateRow[]): number | null {
  const direct = resolveId(rows.map((row) => row.id))
  if (direct !== null) return direct

  let candidates = rows

  const defaultOnly = candidates.filter((row) => row.defaultVersion)
  if (defaultOnly.length > 0) candidates = defaultOnly

  const unqualified = candidates.filter(
    (row) => !candidates.some((other) => other.pageName !== row.pageName && isQualifiedVariantOf(row.pageName, other.pageName))
  )
  if (unqualified.length > 0) candidates = unqualified

  const exactPageMatch = candidates.filter((row) => row.pageName === itemName)
  if (exactPageMatch.length > 0) candidates = exactPageMatch

  if (candidates.length !== 1) return null
  return toId(candidates[0]?.id)
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
  const rowsByName = new Map<string, CandidateRow[]>()

  log("Reading bucket('infobox_item') — item_name is what DropsLine's name= matches")
  const nameTotal = await client.itemNamePages(async (rows: ItemNameRow[], record, offset) => {
    await writeSnapshot('item-id', `name-offset-${offset}`, record)
    for (const row of rows) {
      const existing = rowsByName.get(row.itemName) ?? []
      for (const id of row.ids) existing.push({ pageName: row.pageName, id, defaultVersion: row.defaultVersion })
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
      itemId: resolveWithDisambiguation(itemName, rows),
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
