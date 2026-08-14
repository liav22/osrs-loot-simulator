import {
  evaluateMultiplier,
  evaluateQuantity,
  defaultFormulaRegistry,
  resolveSimContext,
  type Boss,
  type FormulaRegistry,
  type Node,
} from '@osrs-loot-simulator/loot-model'

export interface QtySaneResult {
  check: 'qty_sane'
  ok: boolean
  detail: string
}

/**
 * PROJECT_PLAN.md 7: ranges have `min <= max`; no negative quantities.
 *
 * `exact`/`range`/`choice` are fully enforced by `QtySpecSchema` at parse
 * time, with no runtime-only case — this was audited and correctly left
 * hardcoded `true` (see docs/DECISIONS.md's "Constant-returning validation
 * checks" entry and `apps/ingest/test/qty-sane-constant.test.ts`'s trip
 * wire). `QtySpec`'s `formula` variant, `Table.qtyMultiplier`, and
 * `TableRefNode.qtyMultiplier` (added for docs/mechanics-model-proposal.md's
 * Extension A) are exactly the kind of runtime-only case that audit
 * anticipated: their numeric output only exists once evaluated against a
 * `SimContext`, the same gap `rates_valid` already has a real implementation
 * for. `Table.rolls`'s `formula`-kind case is included here too, not under
 * `rates_valid`, because it's evaluated via `evaluateQuantity` (an integer
 * count), not `evaluateRate` — it's quantity-shaped, not probability-shaped.
 */
export function checkQtySane(
  boss: Boss,
  formulas: FormulaRegistry = defaultFormulaRegistry
): QtySaneResult {
  const ctx = resolveSimContext(boss, {})
  const failures: string[] = []
  let evaluatedCount = 0

  function visitNode(node: Node, tableId: string): void {
    if (node.kind === 'oneOf') {
      for (const entry of node.entries) visitNode(entry.node, tableId)
      return
    }

    if (node.kind === 'item' && node.qty.kind === 'formula') {
      evaluatedCount++
      const qty = node.qty
      try {
        evaluateQuantity(qty.id, qty.params, ctx, formulas)
      } catch (error) {
        failures.push(
          `table '${tableId}': item '${node.itemKey}' qty formula '${qty.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return
    }

    if (node.kind === 'tableRef' && node.qtyMultiplier !== undefined && typeof node.qtyMultiplier !== 'number') {
      evaluatedCount++
      const multiplier = node.qtyMultiplier
      try {
        evaluateMultiplier(multiplier.id, multiplier.params, ctx, formulas)
      } catch (error) {
        failures.push(
          `table '${tableId}': tableRef '${node.ref}' qtyMultiplier formula '${multiplier.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  for (const table of boss.tables) {
    if (typeof table.rolls !== 'number' && table.rolls.kind === 'formula') {
      evaluatedCount++
      try {
        evaluateQuantity(table.rolls.id, table.rolls.params, ctx, formulas)
      } catch (error) {
        failures.push(
          `table '${table.id}': rolls formula '${table.rolls.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    if (table.qtyMultiplier !== undefined && typeof table.qtyMultiplier !== 'number') {
      evaluatedCount++
      try {
        evaluateMultiplier(table.qtyMultiplier.id, table.qtyMultiplier.params, ctx, formulas)
      } catch (error) {
        failures.push(
          `table '${table.id}': qtyMultiplier formula '${table.qtyMultiplier.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    // Descends into `oneOf`. Its entries carry `LeafNode`s, and an item node
    // there has a full `QtySpec` — including the `formula` variant this check
    // exists for. A flat `for (const entry of table.entries)` loop over
    // `entry.node.kind` could not see one, which is the same node-kind blind
    // spot `refs_resolve` had for a nested `tableRef`.
    for (const entry of table.entries) visitNode(entry.node, table.id)
  }

  if (failures.length > 0) {
    return { check: 'qty_sane', ok: false, detail: failures.join('; ') }
  }
  return {
    check: 'qty_sane',
    ok: true,
    detail:
      evaluatedCount === 0
        ? 'exact/range/choice quantities are schema-enforced; no formula-driven quantity, rolls, or qtyMultiplier present'
        : `${evaluatedCount} formula-driven quantity/rolls/multiplier value(s) evaluated successfully`,
  }
}
