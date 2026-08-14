import { useMemo } from 'react'
import type { Boss, SimContext, SimContextField, Table } from '@osrs-loot-simulator/loot-model'
import { contextSurfaceOf } from '../lib/context-fields'
import type { SimRunParams } from '../lib/url-state'

/**
 * Numeric `SimContext` fields, with the label and bounds each one wants. Only
 * rendered when `contextSurfaceOf` says the boss actually reads the field —
 * see that function for why the set is derived rather than fixed.
 */
const NUMERIC_FIELDS: Partial<
  Record<SimContextField, { label: string; min?: number; max?: number }>
> = {
  points: { label: 'Activity points', min: 0 },
  raidLevel: { label: 'Raid level (invocation)', min: 0, max: 500 },
  deaths: { label: 'Deaths this raid', min: 0 },
  delveLevel: { label: 'Delve level reached', min: 0 },
  wavesReached: { label: 'Waves completed', min: 0 },
  fishingLevel: { label: 'Fishing level', min: 1, max: 99 },
  hitpointsDamage: { label: 'Damage to hitpoints', min: 0 },
  shieldDamage: { label: 'Damage to shield', min: 0 },
}

const BOOLEAN_FIELDS: Partial<Record<SimContextField, string>> = {
  perfectKill: 'Perfect kill (no avoidable damage)',
  isMVP: 'MVP (most damage dealt)',
}

const MOONS: readonly SimContext['moonsKilled'][number][] = ['blood', 'blue', 'eclipse']

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
  /** `data/tables/` — followed when discovering which controls this boss needs. */
  sharedTables?: ReadonlyMap<string, Table>
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

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const raw = Number(e.target.value)
          const n = Number.isFinite(raw) ? raw : (min ?? 0)
          onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? 0, Math.trunc(n))))
        }}
        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
      />
    </label>
  )
}

export function SimContextControls({
  boss,
  sharedTables,
  params,
  onChange,
  onSimulate,
  buttonState,
}: Props) {
  const quests = useMemo(() => questsReferencedBy(boss), [boss])
  const surface = useMemo(() => contextSurfaceOf(boss, sharedTables), [boss, sharedTables])
  const uses = (field: SimContextField) => surface.fields.has(field)

  function setCtx(patch: Partial<SimContext>) {
    onChange({ ...params, ctx: { ...params.ctx, ...patch } })
  }

  function toggleQuest(quest: string, complete: boolean) {
    const set = new Set(params.ctx.questsComplete)
    if (complete) set.add(quest)
    else set.delete(quest)
    setCtx({ questsComplete: [...set] })
  }

  function toggleMoon(moon: SimContext['moonsKilled'][number], killed: boolean) {
    const set = new Set(params.ctx.moonsKilled)
    if (killed) set.add(moon)
    else set.delete(moon)
    setCtx({ moonsKilled: MOONS.filter((m) => set.has(m)) })
  }

  function setOwned(itemKey: string, n: number) {
    setCtx({ ownedCounts: { ...params.ctx.ownedCounts, [itemKey]: Math.max(0, n) } })
  }

  const numericShown = (Object.keys(NUMERIC_FIELDS) as SimContextField[]).filter(uses)
  const booleanShown = (Object.keys(BOOLEAN_FIELDS) as SimContextField[]).filter(uses)

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

      {uses('moonsKilled') && (
        <div className="space-y-1">
          <span className="block text-sm text-neutral-400">Moons killed before this chest</span>
          {MOONS.map((moon) => (
            <Toggle
              key={moon}
              label={`${moon[0]?.toUpperCase()}${moon.slice(1)} Moon`}
              checked={params.ctx.moonsKilled.includes(moon)}
              onChange={(v) => toggleMoon(moon, v)}
            />
          ))}
        </div>
      )}

      {booleanShown.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {booleanShown.map((field) => (
            <Toggle
              key={field}
              label={BOOLEAN_FIELDS[field] ?? field}
              checked={Boolean(params.ctx[field])}
              onChange={(v) => setCtx({ [field]: v } as Partial<SimContext>)}
            />
          ))}
        </div>
      )}

      {numericShown.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {numericShown.map((field) => {
            const spec = NUMERIC_FIELDS[field]
            if (spec === undefined) return null
            return (
              <NumberField
                key={field}
                label={spec.label}
                value={Number(params.ctx[field])}
                min={spec.min}
                max={spec.max}
                onChange={(v) => setCtx({ [field]: v } as Partial<SimContext>)}
              />
            )
          })}
        </div>
      )}

      {surface.ownershipItemKeys.length > 0 && (
        <div className="space-y-2">
          <span className="block text-sm text-neutral-400">
            Already owned entering the run (duplicate protection)
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {surface.ownershipItemKeys.map((itemKey) => (
              <NumberField
                key={itemKey}
                label={itemKey}
                value={params.ctx.ownedCounts[itemKey] ?? 0}
                min={0}
                onChange={(v) => setOwned(itemKey, v)}
              />
            ))}
          </div>
        </div>
      )}

      {uses('killCount') && (
        <NumberField
          label="Kill count (for KC-gated drops)"
          value={params.ctx.killCount}
          min={0}
          onChange={(v) => setCtx({ killCount: v })}
        />
      )}

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
