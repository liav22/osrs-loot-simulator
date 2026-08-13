import { useMemo } from 'react'
import type { Boss, SimContext } from '@osrs-loot-simulator/loot-model'
import type { SimRunParams } from '../lib/url-state'

/** Every distinct quest a boss's own conditions reference — no point showing a free-text field for this. */
function questsReferencedBy(boss: Boss): string[] {
  const quests = new Set<string>()
  for (const table of boss.tables) {
    for (const entry of table.entries) {
      for (const condition of entry.conditions ?? []) {
        if (condition.kind === 'questComplete') quests.add(condition.quest)
      }
    }
  }
  return [...quests].sort()
}

interface Props {
  boss: Boss
  params: SimRunParams
  onChange: (params: SimRunParams) => void
  onSimulate: () => void
  buttonState: 'idle' | 'running' | 'loading-prices'
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-amber-500"
      />
    </label>
  )
}

export function SimContextControls({ boss, params, onChange, onSimulate, buttonState }: Props) {
  const quests = useMemo(() => questsReferencedBy(boss), [boss])

  function setCtx(patch: Partial<SimContext>) {
    onChange({ ...params, ctx: { ...params.ctx, ...patch } })
  }

  function toggleQuest(quest: string, complete: boolean) {
    const set = new Set(params.ctx.questsComplete)
    if (complete) set.add(quest)
    else set.delete(quest)
    setCtx({ questsComplete: [...set] })
  }

  return (
    <div className="space-y-3 rounded-md border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="text-sm font-semibold text-neutral-300">Simulation context</h2>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Toggle label="Members" checked={params.ctx.members} onChange={(v) => setCtx({ members: v })} />
        <Toggle label="Ring of wealth" checked={params.ctx.ringOfWealth} onChange={(v) => setCtx({ ringOfWealth: v })} />
        <Toggle label="On slayer task" checked={params.ctx.onSlayerTask} onChange={(v) => setCtx({ onSlayerTask: v })} />
      </div>

      {boss.variants.length > 1 && (
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Variant</span>
          <select
            value={params.ctx.variant}
            onChange={(e) => setCtx({ variant: e.target.value })}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          >
            {boss.variants.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
        </label>
      )}

      {quests.length > 0 && (
        <div className="space-y-1">
          <span className="block text-sm text-neutral-400">Quests complete</span>
          {quests.map((quest) => (
            <Toggle
              key={quest}
              label={quest}
              checked={params.ctx.questsComplete.includes(quest)}
              onChange={(v) => toggleQuest(quest, v)}
            />
          ))}
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-400">Kill count (for KC-gated drops)</span>
        <input
          type="number"
          min={0}
          value={params.ctx.killCount}
          onChange={(e) => setCtx({ killCount: Math.max(0, Number(e.target.value) || 0) })}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Kills to simulate</span>
          <input
            type="number"
            min={1}
            max={10_000_000}
            value={params.kills}
            onChange={(e) => onChange({ ...params, kills: Math.max(1, Number(e.target.value) || 1) })}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Seed</span>
          <input
            type="number"
            value={params.seed}
            onChange={(e) => onChange({ ...params, seed: Number(e.target.value) || 0 })}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={onSimulate}
        disabled={buttonState !== 'idle'}
        className="w-full rounded-md bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonState === 'running' ? 'Simulating…' : buttonState === 'loading-prices' ? 'Loading prices…' : 'Simulate'}
      </button>
    </div>
  )
}
