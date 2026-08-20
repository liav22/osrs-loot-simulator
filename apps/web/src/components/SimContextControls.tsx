import { useMemo } from 'react'
import type { Boss, SimContext, SimContextField, Table } from '@osrs-loot-simulator/loot-model'
import { contextSurfaceOf } from '../lib/context-fields'
import type { SimRunParams } from '../lib/url-state'
import { ItemIcon } from './ItemIcon'

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
  roomsSkipped: { label: 'Rooms skipped this raid', min: 0, max: 6 },
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

/**
 * Only the per-boss context surface. The kill count, seed and Simulate button
 * used to live here too; they moved into `BossPanel`, which pins them to the
 * bottom of the boss panel so the primary action stays put no matter how many
 * controls a source derives above it.
 */
interface Props {
  boss: Boss
  /** `data/tables/` — followed when discovering which controls this boss needs. */
  sharedTables?: ReadonlyMap<string, Table>
  params: SimRunParams
  onChange: (params: SimRunParams) => void
  /** Item name -> wiki icon file, so ownership chips are scannable by icon rather than only by reading 12 labels. Optional: `ItemIcon` renders a letter placeholder without it, so a caller that hasn't fetched icons yet loses nothing but the polish. */
  iconFiles?: ReadonlyMap<string, string>
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

/**
 * A single already-owned item, as a toggleable pill rather than a labeled
 * row. Twelve of these (Lunar Chest's three 4-piece sets) read as one
 * "which of these do you already own?" selection at a glance instead of
 * twelve stacked yes/no questions — the actual complaint this replaces a
 * `NumberField`-per-item layout for. `aria-pressed` carries the checked
 * state for assistive tech since the visual state is border/fill color, not
 * a native checkbox.
 */
function OwnershipChip({
  name,
  iconFile,
  checked,
  onChange,
}: {
  name: string
  iconFile: string | undefined
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        checked
          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
          : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300'
      }`}
    >
      <ItemIcon name={name} file={iconFile} size={16} />
      <span>{name}</span>
    </button>
  )
}

export function SimContextControls({ boss, sharedTables, params, onChange, iconFiles }: Props) {
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
  // `maxN <= 1` is "own it or not", which is every gate in the corpus today —
  // see `OwnershipItem.maxN`'s own comment for why this is read from the
  // data rather than assumed permanent.
  const ownershipChips = surface.ownershipItems.filter((item) => item.maxN <= 1)
  const ownershipNumeric = surface.ownershipItems.filter((item) => item.maxN > 1)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {/*
          No "Members" toggle: every user is assumed to be a member, which is
          already `DEFAULT_SIM_CONTEXT.members`. Sources that genuinely have a
          free-to-play outcome get the inverted control instead — checked means
          `members: false`, so only the F2P table rolls. `freeToPlayVariant`
          explains why the signal is a `members: false` gate rather than the
          mere presence of a members condition.

          Nothing about the underlying context changed: `members` is still a
          real `SimContext` field, still defaults to true, and still
          round-trips through the `members` URL param untouched. A shared link
          carrying `members=0` reproduces exactly as before on every boss,
          including the ones that now render no control for it.
        */}
        {surface.freeToPlayVariant && (
          <Toggle
            label="Free-to-play"
            checked={!params.ctx.members}
            onChange={(v) => setCtx({ members: !v })}
          />
        )}
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
        <div className="grid grid-cols-1 gap-2">
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

      {surface.ownershipItems.length > 0 && (
        <div className="space-y-2">
          <span className="block text-sm text-neutral-400">
            Already owned entering the run (duplicate protection)
          </span>
          {/*
            Split by precision the DATA actually needs, not assumed: every
            `ownershipGate` in the corpus today is `n: 1` ("own it or not"),
            so `chipItems` covers all of them and this numeric fallback
            currently renders nothing. It stays wired up rather than deleted
            so a future source needing `n > 1` gets a working control
            immediately, for just that item, without this component being
            touched again.
          */}
          {ownershipChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ownershipChips.map((item) => (
                <OwnershipChip
                  key={item.itemKey}
                  name={item.name}
                  iconFile={iconFiles?.get(item.name)}
                  checked={(params.ctx.ownedCounts[item.itemKey] ?? 0) >= 1}
                  onChange={(v) => setOwned(item.itemKey, v ? 1 : 0)}
                />
              ))}
            </div>
          )}
          {ownershipNumeric.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              {ownershipNumeric.map((item) => (
                <NumberField
                  key={item.itemKey}
                  label={item.name}
                  value={params.ctx.ownedCounts[item.itemKey] ?? 0}
                  min={0}
                  onChange={(v) => setOwned(item.itemKey, v)}
                />
              ))}
            </div>
          )}
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
    </div>
  )
}
