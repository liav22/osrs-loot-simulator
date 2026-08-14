import type { Condition, Entry, Node, Table } from '@osrs-loot-simulator/loot-model'
import { formatFraction, formatPercent, formatQty } from '../lib/format'

function conditionLabel(condition: Condition): string {
  switch (condition.kind) {
    case 'members':
      return condition.value ? 'Members' : 'F2P'
    case 'ringOfWealth':
      return condition.value ? 'Ring of wealth' : 'No ring of wealth'
    case 'onSlayerTask':
      return condition.value ? 'On slayer task' : 'Not on slayer task'
    case 'questComplete':
      return condition.quest
    case 'killCountAtLeast':
      return `KC ≥ ${condition.n}`
    case 'variant':
      return condition.name
    case 'levelAtLeast': {
      // An exhaustive record, not a ternary. The ternary this replaced
      // silently labelled every field except `delveLevel` as "Wave", so
      // widening the enum for Zalcano would have rendered "Wave ≥ 31" for a
      // damage threshold — a new field must fail the typecheck here, which is
      // the whole point of this switch being a trip wire.
      const labels: Record<typeof condition.field, string> = {
        delveLevel: 'Delve level',
        wavesReached: 'Wave',
        shieldDamage: 'Shield damage',
        totalDamage: 'Combined damage',
      }
      return `${labels[condition.field]} ≥ ${condition.n}`
    }
    case 'includes': {
      // `values` is a disjunction (see ConditionSchema), so read it as "or".
      const label = condition.field === 'moonsKilled' ? 'Killed' : 'Completed'
      return `${label} ${condition.values.join(' or ')}`
    }
  }
}

function NodeLabel({ node }: { node: Node }) {
  switch (node.kind) {
    case 'item':
      return (
        <span>
          {node.name}
          {node.qty.kind !== 'exact' || node.qty.n !== 1 ? (
            <span className="text-neutral-500"> ×{formatQty(node.qty)}</span>
          ) : null}
          {node.noted === true && <span className="text-neutral-500"> (noted)</span>}
          {node.itemId === null && <span className="ml-1 text-amber-500" title="Item id unresolved">⚠</span>}
        </span>
      )
    case 'nothing':
      return <span className="italic text-neutral-500">Nothing</span>
    case 'tableRef':
      return <span className="text-sky-400">→ {node.ref}</span>
    case 'oneOf':
      return (
        <span className="text-neutral-300">
          one of: {node.entries.map((e) => (e.node.kind === 'item' ? e.node.name : e.node.kind)).join(', ')}
        </span>
      )
  }
}

function entryRateDisplay(entry: Entry, table: Table): string {
  const { rate } = entry
  if (rate.kind === 'weight' && table.denominator !== undefined) {
    return `${formatFraction(rate.weight, table.denominator)} (${formatPercent(rate.weight / table.denominator)})`
  }
  if (rate.kind === 'fixed') return `${formatFraction(rate.num, rate.den)} (${formatPercent(rate.num / rate.den)})`
  if (rate.kind === 'always') return 'Always'
  if (rate.kind === 'formula') return `formula: ${rate.id}`
  return String(rate.weight)
}

function TableCard({ table }: { table: Table }) {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <div className="text-sm font-medium text-neutral-200">{table.notes ?? table.id}</div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 uppercase tracking-wide">{table.mode}</span>
          {table.denominator !== undefined && <span>denominator {table.denominator}</span>}
          {typeof table.rolls === 'number' && table.rolls !== 1 && <span>rolls ×{table.rolls}</span>}
          {table.withoutReplacement && <span>without replacement</span>}
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-neutral-900">
          {table.entries.map((entry, i) => (
            <tr key={i} className="hover:bg-neutral-900/60">
              <td className="px-3 py-1.5">
                <NodeLabel node={entry.node} />
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-xs text-neutral-400">
                {entryRateDisplay(entry, table)}
              </td>
              <td className="px-3 py-1.5 text-right text-xs text-neutral-500">
                {entry.conditions?.map(conditionLabel).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DropTableView({ tables }: { tables: readonly Table[] }) {
  return (
    <div className="space-y-4">
      {tables.map((table) => (
        <TableCard key={table.id} table={table} />
      ))}
    </div>
  )
}
