import { resolveSimContext, type Boss, type SimContext } from '@osrs-loot-simulator/loot-model'

function booleanLabel(field: keyof SimContext, value: boolean): string {
  switch (field) {
    case 'members':
      return value ? 'Members' : 'F2P'
    case 'ringOfWealth':
      return value ? 'Ring of wealth' : 'No ring of wealth'
    case 'onKonarTask':
      return value ? 'On Konar task' : 'Not on Konar task'
    case 'awakened':
      return value ? 'Awakened' : 'Not awakened'
    case 'perfectKill':
      return value ? 'Perfect kill' : 'Not a perfect kill'
    case 'isMVP':
      return value ? 'MVP' : 'Not MVP'
    default:
      return String(value)
  }
}

const BOOLEAN_FIELDS = ['members', 'ringOfWealth', 'onKonarTask', 'awakened', 'perfectKill', 'isMVP'] as const

const NUMERIC_LABELS: Partial<Record<keyof SimContext, string>> = {
  killCount: 'KC',
  points: 'Points',
  raidLevel: 'Raid level',
  deaths: 'Deaths',
  roomsSkipped: 'Rooms skipped',
  delveLevel: 'Delve level',
  wavesReached: 'Wave',
  fishingLevel: 'Fishing level',
}

/**
 * One short line summarizing whichever context fields differ from this
 * boss's own defaults (e.g. "Raid level 400 · On Konar task"), so the item
 * probability modal can show what context its numbers assume without
 * dumping the entire `SimContext`. Mirrors `DropTableView`'s condition-label
 * vocabulary rather than inventing a second one.
 */
export function contextSummary(boss: Boss, ctx: SimContext): string {
  const defaults = resolveSimContext(boss, {})
  const parts: string[] = []

  for (const field of BOOLEAN_FIELDS) {
    if (ctx[field] !== defaults[field]) parts.push(booleanLabel(field, ctx[field]))
  }

  for (const [field, label] of Object.entries(NUMERIC_LABELS) as [keyof SimContext, string][]) {
    if (ctx[field] !== defaults[field]) parts.push(`${label} ${ctx[field] as number}`)
  }

  if (ctx.variant !== defaults.variant) parts.push(ctx.variant)

  const moonsChanged =
    ctx.moonsKilled.length !== defaults.moonsKilled.length ||
    ctx.moonsKilled.some((moon, i) => moon !== defaults.moonsKilled[i])
  if (moonsChanged) {
    parts.push(ctx.moonsKilled.length > 0 ? `Killed ${ctx.moonsKilled.join(', ')}` : 'No moons killed')
  }

  return parts.length > 0 ? parts.join(' · ') : 'Default context'
}
