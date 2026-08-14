import type { Node, Table } from '@osrs-loot-simulator/loot-model'
import type { ItemCheckInput } from '../validate/items-known.js'

/**
 * Every item node in a document, for `items_known`.
 *
 * This was four lines inline in `parseBoss` — a flat
 * `for (const entry of table.entries) if (entry.node.kind === 'item')` — and it
 * was the fourth guard found permissive in the same way as the other three
 * (see docs/DECISIONS.md's scope-invariant entry). An item nested one level
 * down inside a `oneOf` was never collected, so `items_known` reported a clean
 * pass for a document containing an item that resolves to nothing. Legal per
 * `LeafNodeSchema`; no source does it today.
 *
 * It lives in its own module rather than inline now for two reasons: the walk
 * is recursive and no longer reads as incidental, and a scope-mutation test
 * needs to call it directly rather than through the whole parse pipeline.
 *
 * **`tableRef` is deliberately NOT followed.** A shared table's items are that
 * record's own business — following the ref would re-validate
 * `rare_drop_table`'s contents once per referencing boss, attribute any failure
 * to whichever boss happened to be parsed, and make one bad shared record fail
 * seventeen sources with seventeen identical messages. `data/tables/` records
 * are validated as themselves. This is a scope decision, so it is stated here
 * rather than left implicit in the shape of the loop — which is the whole
 * lesson of the audit that produced this file.
 */
export function collectItemInputs(tables: readonly Table[]): ItemCheckInput[] {
  const items: ItemCheckInput[] = []

  function visit(node: Node): void {
    if (node.kind === 'oneOf') {
      for (const entry of node.entries) visit(entry.node)
      return
    }
    if (node.kind === 'item') {
      items.push({ itemKey: node.itemKey, itemId: node.itemId })
    }
  }

  for (const table of tables) {
    for (const entry of table.entries) visit(entry.node)
  }
  return items
}
