import { useMemo, useState } from 'react'
import { itemMilestones, type Boss, type SimContext, type Table } from '@osrs-loot-simulator/loot-model'
import { Modal } from './Modal'
import { formatNumber, formatPercent } from '../lib/format'
import { contextSummary } from '../lib/context-summary'
import { attemptLabelFor, capitalizeLabel } from '../lib/attempt-label'

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

/** Highest count the on-the-fly compound-distribution search stays comfortably fast at in the browser. */
const MAX_TARGET_COUNT = 200

export function ItemProbabilityModal({ boss, ctx, sharedTables, itemKey, itemName, onClose }: Props) {
  // Kept as a string so the input can sit empty/mid-edit without snapping
  // back to a number on every keystroke; parsed and clamped at use time.
  const [targetCountInput, setTargetCountInput] = useState('1')
  const targetCount = Math.min(MAX_TARGET_COUNT, Math.max(1, Math.round(Number(targetCountInput) || 1)))

  const result = useMemo(
    () => itemMilestones(boss, ctx, itemKey, targetCount, { tables: sharedTables }),
    [boss, ctx, itemKey, targetCount, sharedTables]
  )
  const attemptLabel = attemptLabelFor(boss)

  return (
    <Modal
      title={itemName}
      titleAccessory={(
        <a
          href={`https://oldschool.runescape.wiki/w/${encodeURIComponent(itemName.replace(/ /g, '_'))}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs font-normal text-muted hover:text-amber-400 hover:underline"
        >
          OSRS Wiki ↗
        </a>
      )}
      onClose={onClose}
    >
      <p className="mb-3 text-xs text-muted">{contextSummary(boss, ctx)}</p>

      <label className="mb-3 flex items-center gap-2 text-sm text-neutral-300">
        Chance of at least
        <input
          type="number"
          min={1}
          max={MAX_TARGET_COUNT}
          step={1}
          value={targetCountInput}
          onChange={(event) => setTargetCountInput(event.target.value)}
          className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center font-mono text-neutral-100"
        />
        {targetCount === 1 ? 'drop' : 'drops'}
      </label>

      {result.classification.kind === 'unsupported' ? (
        <p className="rounded-md border border-neutral-800 px-3 py-4 text-sm text-muted">
          {UNSUPPORTED_MESSAGES[result.classification.reason]}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1 pr-4">Chance</th>
              <th className="py-1">{capitalizeLabel(attemptLabel.plural)} needed</th>
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
