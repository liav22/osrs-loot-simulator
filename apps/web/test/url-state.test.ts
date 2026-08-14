import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KILLS,
  DEFAULT_SEED,
  paramsFromSearch,
  searchFromParams,
  type SimRunParams,
} from '../src/lib/url-state'
import { DEFAULT_SIM_CONTEXT } from '@osrs-loot-simulator/loot-model'

describe('paramsFromSearch', () => {
  it('falls back to defaults for an empty search', () => {
    const params = paramsFromSearch(new URLSearchParams())
    expect(params.ctx).toEqual(DEFAULT_SIM_CONTEXT)
    expect(params.seed).toBe(DEFAULT_SEED)
    expect(params.kills).toBe(DEFAULT_KILLS)
  })

  it('reads every field from the query string', () => {
    const params = paramsFromSearch(
      new URLSearchParams('members=0&row=1&slayer=1&quests=Dragon+Slayer,Legends%27+Quest&kc=50&variant=hard&seed=7&n=5000')
    )
    expect(params.ctx).toEqual({
      ...DEFAULT_SIM_CONTEXT,
      members: false,
      ringOfWealth: true,
      onSlayerTask: true,
      questsComplete: ['Dragon Slayer', "Legends' Quest"],
      killCount: 50,
      variant: 'hard',
    })
    expect(params.seed).toBe(7)
    expect(params.kills).toBe(5000)
  })
})

describe('searchFromParams', () => {
  it('omits fields that equal the default (keeps shareable URLs short)', () => {
    const search = searchFromParams({ ctx: DEFAULT_SIM_CONTEXT, seed: DEFAULT_SEED, kills: DEFAULT_KILLS })
    expect(search.has('members')).toBe(false)
    expect(search.has('row')).toBe(false)
    expect(search.get('seed')).toBe(String(DEFAULT_SEED))
    expect(search.get('n')).toBe(String(DEFAULT_KILLS))
  })

  it('round-trips through paramsFromSearch', () => {
    const original = {
      ctx: { ...DEFAULT_SIM_CONTEXT, ringOfWealth: true, onSlayerTask: true, questsComplete: ['Dragon Slayer'], killCount: 12, variant: 'hard' },
      seed: 42,
      kills: 250_000,
    }
    const roundTripped = paramsFromSearch(searchFromParams(original))
    expect(roundTripped).toEqual(original)
  })
})

/**
 * The Extension A / B fields had no URL params, so a delve-8 Doom run or a
 * Zalcano MVP kill could be configured but not shared — half of what
 * PROJECT_PLAN.md 9 asks for ("shareable and reproducible").
 */
describe('SimContext fields beyond the original six', () => {
  it('round-trips every newly-wired field', () => {
    const params: SimRunParams = {
      ctx: {
        ...DEFAULT_SIM_CONTEXT,
        delveLevel: 8,
        wavesReached: 12,
        points: 900,
        raidLevel: 300,
        deaths: 2,
        fishingLevel: 99,
        hitpointsDamage: 400,
        shieldDamage: 300,
        perfectKill: true,
        isMVP: true,
        moonsKilled: ['blood', 'eclipse'],
        ownedCounts: { 'blood-moon-helm': 1, 'eclipse-moon-chestplate': 2 },
      },
      seed: 7,
      kills: 5000,
    }

    const round = paramsFromSearch(searchFromParams(params))
    expect(round.ctx).toEqual(params.ctx)
    expect(round.seed).toBe(7)
    expect(round.kills).toBe(5000)
  })

  it('keeps a default run’s link clean', () => {
    const search = searchFromParams({
      ctx: { ...DEFAULT_SIM_CONTEXT },
      seed: 1,
      kills: 10_000,
    })
    // Only seed and n, exactly as before these fields were wired.
    expect([...search.keys()].sort()).toEqual(['n', 'seed'])
  })

  it('never writes the derived totalDamage into the URL', () => {
    // It is recomputed from its inputs, so a value in the link would be
    // overwritten — a param that silently does nothing.
    const search = searchFromParams({
      ctx: { ...DEFAULT_SIM_CONTEXT, hitpointsDamage: 400, shieldDamage: 300, totalDamage: 700 },
      seed: 1,
      kills: 10,
    })
    expect(search.has('totaldmg')).toBe(false)
    expect([...search.keys()]).toContain('hpdmg')
    expect([...search.keys()]).toContain('shielddmg')
  })
})
