import { DEFAULT_SIM_CONTEXT, type SimContext } from '@osrs-loot-simulator/loot-model'

/**
 * `SimContext` (+ the simulation's own seed/kill-count, which aren't part of
 * the model's context but need the same "shareable, reproducible" treatment)
 * encoded into URL search params. PROJECT_PLAN.md 9: "Expose the seed in the
 * UI and put it in the URL so results are shareable and reproducible" and
 * "/boss/:slug — deep-linkable, context and seed encoded in query params."
 */

export interface SimRunParams {
  ctx: SimContext
  seed: number
  kills: number
}

export const DEFAULT_KILLS = 10_000
export const DEFAULT_SEED = 1

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  return value === '1' || value === 'true'
}

function parseIntParam(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Numeric context fields with a URL param each, so a Doom of Mokhaiotl delve-8
 * run or a Zalcano MVP kill is as shareable as a ring-of-wealth run always
 * was. Short names, since these end up in a link someone pastes.
 *
 * `totalDamage` is deliberately absent: it is derived from `hitpointsDamage`
 * and `shieldDamage` by `withDerivedContext`, so encoding it would put a value
 * in the URL that the model then overwrites.
 */
const NUMERIC_PARAMS = {
  points: 'pts',
  raidLevel: 'raid',
  deaths: 'deaths',
  delveLevel: 'delve',
  wavesReached: 'wave',
  fishingLevel: 'fishing',
  hitpointsDamage: 'hpdmg',
  shieldDamage: 'shielddmg',
} as const satisfies Partial<Record<keyof SimContext, string>>

const BOOLEAN_PARAMS = {
  perfectKill: 'perfect',
  isMVP: 'mvp',
} as const satisfies Partial<Record<keyof SimContext, string>>

const MOONS = ['blood', 'blue', 'eclipse'] as const

function parseMoons(raw: string | null): SimContext['moonsKilled'] {
  if (raw === null || raw === '') return []
  const wanted = new Set(raw.split(','))
  return MOONS.filter((moon) => wanted.has(moon))
}

/** `key:count` pairs, e.g. `owned=blood-moon-helm:1,eclipse-moon-chestplate:2`. */
function parseOwned(raw: string | null): SimContext['ownedCounts'] {
  if (raw === null || raw === '') return {}
  const owned: Record<string, number> = {}
  for (const pair of raw.split(',')) {
    const at = pair.lastIndexOf(':')
    if (at <= 0) continue
    const key = pair.slice(0, at)
    const n = Number.parseInt(pair.slice(at + 1), 10)
    if (Number.isFinite(n) && n >= 0) owned[key] = n
  }
  return owned
}

export function paramsFromSearch(search: URLSearchParams): SimRunParams {
  const questsRaw = search.get('quests')
  const ctx: SimContext = {
    ...DEFAULT_SIM_CONTEXT,
    members: parseBool(search.get('members'), DEFAULT_SIM_CONTEXT.members),
    ringOfWealth: parseBool(search.get('row'), DEFAULT_SIM_CONTEXT.ringOfWealth),
    onSlayerTask: parseBool(search.get('slayer'), DEFAULT_SIM_CONTEXT.onSlayerTask),
    questsComplete: questsRaw === null || questsRaw === '' ? [] : questsRaw.split(','),
    killCount: parseIntParam(search.get('kc'), DEFAULT_SIM_CONTEXT.killCount),
    variant: search.get('variant') ?? DEFAULT_SIM_CONTEXT.variant,
    moonsKilled: parseMoons(search.get('moons')),
    ownedCounts: parseOwned(search.get('owned')),
  }
  for (const [field, param] of Object.entries(NUMERIC_PARAMS)) {
    const key = field as keyof typeof NUMERIC_PARAMS
    ctx[key] = parseIntParam(search.get(param), DEFAULT_SIM_CONTEXT[key])
  }
  for (const [field, param] of Object.entries(BOOLEAN_PARAMS)) {
    const key = field as keyof typeof BOOLEAN_PARAMS
    ctx[key] = parseBool(search.get(param), DEFAULT_SIM_CONTEXT[key])
  }
  return {
    ctx,
    seed: parseIntParam(search.get('seed'), DEFAULT_SEED),
    kills: parseIntParam(search.get('n'), DEFAULT_KILLS),
  }
}

export function searchFromParams(params: SimRunParams): URLSearchParams {
  const search = new URLSearchParams()
  if (params.ctx.members !== DEFAULT_SIM_CONTEXT.members) search.set('members', params.ctx.members ? '1' : '0')
  if (params.ctx.ringOfWealth) search.set('row', '1')
  if (params.ctx.onSlayerTask) search.set('slayer', '1')
  if (params.ctx.questsComplete.length > 0) search.set('quests', params.ctx.questsComplete.join(','))
  if (params.ctx.killCount !== 0) search.set('kc', String(params.ctx.killCount))
  if (params.ctx.variant !== DEFAULT_SIM_CONTEXT.variant) search.set('variant', params.ctx.variant)
  if (params.ctx.moonsKilled.length > 0) search.set('moons', params.ctx.moonsKilled.join(','))

  const owned = Object.entries(params.ctx.ownedCounts).filter(([, n]) => n > 0)
  if (owned.length > 0) {
    search.set('owned', owned.map(([key, n]) => `${key}:${n}`).join(','))
  }

  // Only non-default values are written, so a plain /boss/vorkath link stays
  // clean — the same rule the six original fields already followed.
  for (const [field, param] of Object.entries(NUMERIC_PARAMS)) {
    const key = field as keyof typeof NUMERIC_PARAMS
    if (params.ctx[key] !== DEFAULT_SIM_CONTEXT[key]) search.set(param, String(params.ctx[key]))
  }
  for (const [field, param] of Object.entries(BOOLEAN_PARAMS)) {
    const key = field as keyof typeof BOOLEAN_PARAMS
    if (params.ctx[key] !== DEFAULT_SIM_CONTEXT[key]) search.set(param, params.ctx[key] ? '1' : '0')
  }

  search.set('seed', String(params.seed))
  search.set('n', String(params.kills))
  return search
}
