import { isAllowlisted, type ItemAllowlist } from '../items/allowlist.js'
import { indexByItemKey, type ItemIndex, type ItemIndexEntry } from '../items/index.js'

/**
 * The `items_known` check (PROJECT_PLAN.md 7): every `itemId` resolves
 * against the item index.
 *
 * An item node passes when either:
 *   - its `itemId` resolves against `data/_item-index.json` (matched by
 *     `itemKey`, and the index's own id agrees), or
 *   - its `itemKey` is in `data/item-multi-id-allowlist.json`, declaring it a
 *     known, legitimate case of "cannot resolve to one id".
 *
 * Anything else fails: an unresolved item that is not on the allowlist is
 * usually a real gap, not a known exception, and the check must not paper
 * over the difference.
 */

export interface ItemCheckInput {
  itemKey: string
  itemId: number | null
}

export interface ItemCheckFailure {
  itemKey: string
  itemId: number | null
  reason: string
}

export interface ItemsKnownResult {
  check: 'items_known'
  ok: boolean
  detail?: string
  failures: ItemCheckFailure[]
}

export function checkItemsKnown(
  items: readonly ItemCheckInput[],
  itemIndex: ItemIndex,
  allowlist: ItemAllowlist
): ItemsKnownResult {
  const byKey = indexByItemKey(itemIndex)
  const failures: ItemCheckFailure[] = []

  for (const item of items) {
    if (isAllowlisted(allowlist, item.itemKey)) continue

    const entry: ItemIndexEntry | undefined = byKey.get(item.itemKey)
    if (entry === undefined) {
      failures.push({
        itemKey: item.itemKey,
        itemId: item.itemId,
        reason: `'${item.itemKey}' is not in the item index and not on the multi-id allowlist`,
      })
      continue
    }
    if (entry.itemId === null) {
      failures.push({
        itemKey: item.itemKey,
        itemId: item.itemId,
        reason:
          `'${item.itemKey}' does not resolve to a single item id ` +
          `(raw: ${JSON.stringify(entry.rawIds)}) and is not on the multi-id allowlist`,
      })
      continue
    }
    if (item.itemId !== entry.itemId) {
      failures.push({
        itemKey: item.itemKey,
        itemId: item.itemId,
        reason: `node has itemId ${item.itemId}, but the item index resolves '${item.itemKey}' to ${entry.itemId}`,
      })
    }
  }

  return {
    check: 'items_known',
    ok: failures.length === 0,
    detail: failures.length === 0 ? undefined : `${failures.length} item(s) failed to resolve`,
    failures,
  }
}
