import { DEFAULT_SIM_CONTEXT, type PartialSimContext, type SimContext } from '@osrs-loot-simulator/loot-model'

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
  /**
   * Whether this link describes a run that has already been simulated, as
   * opposed to a boss someone is about to configure.
   *
   * The seed and kill count were always in the URL, but a pasted link still
   * landed on an empty results panel until the recipient clicked Simulate —
   * so "simulate 5,000 Vorkath kills, get three visages, share the link" did
   * not actually reproduce anything. Set when Simulate is pressed; on load, it
   * is what tells `BossView` to re-run immediately. Kept out of the URL when
   * false so a plain /boss/vorkath link stays clean and does not kick off a
   * simulation nobody asked for.
   */
  run: boolean
}

export const DEFAULT_KILLS = 10_000

/**
 * A run this size is already exercised by `e2e/layout.spec.ts`'s "a large
 * table at 1,000,000 kills collapses, expands, and overflows nothing" — the
 * largest size actually verified not to lock up the tab. There was no upper
 * bound at all before this: the input's `max` attribute doesn't stop a typed
 * value or a `?n=` query param from exceeding it, so `simulate()` would
 * happily try to run (and log/tally) an arbitrarily large kill count
 * synchronously on the main thread.
 */
export const MAX_KILLS = 1_000_000

/**
 * `0` is a sentinel meaning "pick a fresh seed for this run", and it is the
 * default.
 *
 * The old default was a literal `1`, which meant every visitor's first
 * simulation of a boss produced byte-identical drops — the same three visages,
 * for everyone, forever. That reads as a fixed answer rather than a sample, and
 * it is the opposite of what someone pressing Simulate repeatedly is trying to
 * see.
 *
 * The seed the run actually used is written to the URL and shown in the results
 * summary, so reproducibility is untouched: a shared link carries a real seed
 * and replays exactly. The input keeps showing `0`, so the next click rolls
 * again rather than repeating the last run.
 */
export const RANDOM_SEED = 0
export const DEFAULT_SEED = RANDOM_SEED

/**
 * A seed for a run whose input said `0`. Never returns `0` itself — that value
 * means "roll one", so a run stamped with it would re-roll on reload instead of
 * reproducing.
 */
export function rollSeed(): number {
  return 1 + Math.floor(Math.random() * 0xffffffff)
}

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
 * `totalDamage` and `tobPoints` are deliberately absent: both are derived
 * (from `hitpointsDamage`/`shieldDamage` and `roomsSkipped`/`deaths`
 * respectively) by `withDerivedContext`, so encoding either would put a value
 * in the URL that the model then overwrites.
 */
const NUMERIC_PARAMS = {
  points: 'pts',
  raidLevel: 'raid',
  deaths: 'deaths',
  roomsSkipped: 'skip',
  delveLevel: 'delve',
  wavesReached: 'wave',
  fishingLevel: 'fishing',
  hitpointsDamage: 'hpdmg',
  shieldDamage: 'shielddmg',
} as const satisfies Partial<Record<keyof SimContext, string>>

const BOOLEAN_PARAMS = {
  perfectKill: 'perfect',
  isMVP: 'mvp',
  onKonarTask: 'konar',
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

/**
 * Merges the package's global defaults with a boss's own `contextDefaults`
 * (Vorkath's `variant: 'Post-quest'`, Zalcano's damage inputs, ancient chest's
 * `points`, ...). `resolveSimContext` (loot-model) does the identical merge
 * for `expectedValue`/`simulate` callers that already have a concrete
 * `SimContext` to layer overrides onto; this is the same merge used as the
 * FALLBACK when parsing/serializing a `SimContext` from scratch, so a boss
 * whose sole variant isn't literally named `'normal'` doesn't silently filter
 * every drop out from under a plain, unconfigured link.
 */
function resolveDefaults(contextDefaults: PartialSimContext): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, ...contextDefaults }
}

export function paramsFromSearch(
  search: URLSearchParams,
  contextDefaults: PartialSimContext = {}
): SimRunParams {
  const defaults = resolveDefaults(contextDefaults)
  const questsRaw = search.get('quests')
  const ctx: SimContext = {
    ...defaults,
    members: parseBool(search.get('members'), defaults.members),
    ringOfWealth: parseBool(search.get('row'), defaults.ringOfWealth),
    questsComplete: questsRaw === null || questsRaw === '' ? defaults.questsComplete : questsRaw.split(','),
    killCount: parseIntParam(search.get('kc'), defaults.killCount),
    variant: search.get('variant') ?? defaults.variant,
    moonsKilled: search.get('moons') === null ? defaults.moonsKilled : parseMoons(search.get('moons')),
    ownedCounts: search.get('owned') === null ? defaults.ownedCounts : parseOwned(search.get('owned')),
  }
  for (const [field, param] of Object.entries(NUMERIC_PARAMS)) {
    const key = field as keyof typeof NUMERIC_PARAMS
    ctx[key] = parseIntParam(search.get(param), defaults[key])
  }
  for (const [field, param] of Object.entries(BOOLEAN_PARAMS)) {
    const key = field as keyof typeof BOOLEAN_PARAMS
    ctx[key] = parseBool(search.get(param), defaults[key])
  }
  return {
    ctx,
    seed: parseIntParam(search.get('seed'), DEFAULT_SEED),
    kills: Math.min(MAX_KILLS, parseIntParam(search.get('n'), DEFAULT_KILLS)),
    run: parseBool(search.get('run'), false),
  }
}

export function searchFromParams(params: SimRunParams, contextDefaults: PartialSimContext = {}): URLSearchParams {
  const defaults = resolveDefaults(contextDefaults)
  const search = new URLSearchParams()
  if (params.ctx.members !== defaults.members) search.set('members', params.ctx.members ? '1' : '0')
  if (params.ctx.ringOfWealth !== defaults.ringOfWealth) search.set('row', params.ctx.ringOfWealth ? '1' : '0')
  if (params.ctx.questsComplete.length > 0) search.set('quests', params.ctx.questsComplete.join(','))
  if (params.ctx.killCount !== defaults.killCount) search.set('kc', String(params.ctx.killCount))
  if (params.ctx.variant !== defaults.variant) search.set('variant', params.ctx.variant)
  if (params.ctx.moonsKilled.length > 0) search.set('moons', params.ctx.moonsKilled.join(','))

  const owned = Object.entries(params.ctx.ownedCounts).filter(([, n]) => n > 0)
  if (owned.length > 0) {
    search.set('owned', owned.map(([key, n]) => `${key}:${n}`).join(','))
  }

  // Only values that differ from THIS BOSS's resolved default are written, so
  // a plain /boss/vorkath link stays clean even though Vorkath's own default
  // variant is 'Post-quest', not the package-wide 'normal'.
  for (const [field, param] of Object.entries(NUMERIC_PARAMS)) {
    const key = field as keyof typeof NUMERIC_PARAMS
    if (params.ctx[key] !== defaults[key]) search.set(param, String(params.ctx[key]))
  }
  for (const [field, param] of Object.entries(BOOLEAN_PARAMS)) {
    const key = field as keyof typeof BOOLEAN_PARAMS
    if (params.ctx[key] !== defaults[key]) search.set(param, params.ctx[key] ? '1' : '0')
  }

  search.set('seed', String(params.seed))
  search.set('n', String(params.kills))
  if (params.run) search.set('run', '1')
  return search
}
