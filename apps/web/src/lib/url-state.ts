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

export function paramsFromSearch(search: URLSearchParams): SimRunParams {
  const questsRaw = search.get('quests')
  const ctx: SimContext = {
    members: parseBool(search.get('members'), DEFAULT_SIM_CONTEXT.members),
    ringOfWealth: parseBool(search.get('row'), DEFAULT_SIM_CONTEXT.ringOfWealth),
    onSlayerTask: parseBool(search.get('slayer'), DEFAULT_SIM_CONTEXT.onSlayerTask),
    questsComplete: questsRaw === null || questsRaw === '' ? [] : questsRaw.split(','),
    killCount: parseIntParam(search.get('kc'), DEFAULT_SIM_CONTEXT.killCount),
    variant: search.get('variant') ?? DEFAULT_SIM_CONTEXT.variant,
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
  search.set('seed', String(params.seed))
  search.set('n', String(params.kills))
  return search
}
