import { useMemo } from 'react'
import { itemMilestones, type Boss, type SimContext, type Table } from '@osrs-loot-simulator/loot-model'
import { Modal } from './Modal'
import { formatNumber, formatPercent } from '../lib/format'
import { contextSummary } from '../lib/context-summary'

interface Props {
  boss: Boss
  ctx: SimContext
  sharedTables: ReadonlyMap<string, Table> | undefined
  itemKey: string
  itemName: string
  onClose: () => void
}

const UNSUPPORTED_MESSAGES: Record<'ownership-gated' | 'item-not-found', string> = {
  'ownership-gated':
    "This item is part of a duplicate-protected pool, so its odds change as you collect the others in the set. Exact kill-count odds for it aren't available yet.",
  'item-not-found': "This item's odds aren't available.",
}

export function ItemProbabilityModal({ boss, ctx, sharedTables, itemKey, itemName, onClose }: Props) {
  const result = useMemo(
    () => itemMilestones(boss, ctx, itemKey, { tables: sharedTables }),
    [boss, ctx, sharedTables, itemKey]
  )

  return (
    <Modal title={itemName} onClose={onClose}>
      <p className="mb-3 text-xs text-muted">{contextSummary(boss, ctx)}</p>
      {result.classification.kind === 'unsupported' ? (
        <p className="rounded-md border border-neutral-800 px-3 py-4 text-sm text-muted">
          {UNSUPPORTED_MESSAGES[result.classification.reason]}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1 pr-4">Chance</th>
              <th className="py-1">Kills needed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {result.milestones!.map((row) => (
              <tr key={row.target}>
                <td className="py-1.5 pr-4 font-mono text-neutral-100">{formatPercent(row.target, 1)}</td>
                <td className="py-1.5 font-mono text-neutral-100">
                  {Number.isFinite(row.kills) ? formatNumber(row.kills) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
