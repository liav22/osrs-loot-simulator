import { DROP_JSON_FIELDS } from '../wiki/fields.js'
import { BucketResponseSchema } from '../wiki/schemas.js'
import { extractDropLines } from '../parse/wikitext-drops.js'

/**
 * Hybrid pricing: GE price for tradeable items, High Alch for `gemw=no`
 * items. `dropsline`'s own `Drop Value` field IS the row's High Alch value
 * (established in the Phase 3 ev_matches investigation) — reused here rather
 * than re-derived, since it is exactly what this needs.
 *
 * This exists to test one specific hypothesis: that `Template:Average drop
 * value` falls back to High Alch for the untradeable items it cannot price
 * off the GE, rather than valuing them at 0. See docs/DECISIONS.md for the
 * result.
 *
 * `PriceLookup` (the loot-model contract) takes only `itemId`, so an item
 * that does not resolve to one id — which `gemw=no` items often are, being
 * untradeable and therefore unlisted anywhere a resolver would check — cannot
 * be priced through it by name at call time. The High Alch override is
 * therefore folded into an itemId-keyed price map up front, at map-build
 * time, using whatever itemId the caller already has for that item (the
 * fixture's, in this test — not derived here).
 */

/** item name (as it appears in `dropsline`) -> High Alch value, for `gemw=no` rows. */
export function highAlchByItemName(wikitext: string, dropslineBody: unknown): Map<string, number> {
  const lines = extractDropLines(wikitext)
  const gemwNoNames = new Set(lines.filter((line) => line.gemwNo).map((line) => line.name))
  if (gemwNoNames.size === 0) return new Map()

  const response = BucketResponseSchema.parse(dropslineBody)
  const alchByName = new Map<string, number>()
  for (const raw of response.bucket ?? []) {
    const row = raw as Record<string, unknown>
    const itemName = row['item_name']
    if (typeof itemName !== 'string' || !gemwNoNames.has(itemName)) continue
    const dropJson = JSON.parse(row['drop_json'] as string) as Record<string, unknown>
    const value = dropJson[DROP_JSON_FIELDS.dropValue]
    if (typeof value === 'number' && !alchByName.has(itemName)) alchByName.set(itemName, value)
  }
  return alchByName
}

/**
 * Overlays High Alch values onto a base itemId->price map (typically live GE
 * prices), given a itemId->name mapping to join `highAlchByItemName` against.
 */
export function applyHighAlchOverride(
  basePrices: ReadonlyMap<number, number>,
  itemIdToName: ReadonlyMap<number, string>,
  highAlch: ReadonlyMap<string, number>
): Map<number, number> {
  const merged = new Map(basePrices)
  for (const [itemId, name] of itemIdToName) {
    const alch = highAlch.get(name)
    if (alch !== undefined) merged.set(itemId, alch)
  }
  return merged
}
