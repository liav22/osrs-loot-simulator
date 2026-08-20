import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KILLS,
  DEFAULT_SEED,
  MAX_KILLS,
  paramsFromSearch,
  RANDOM_SEED,
  rollSeed,
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
      new URLSearchParams('members=0&row=1&konar=1&quests=Dragon+Slayer,Legends%27+Quest&kc=50&variant=hard&seed=7&n=5000')
    )
    expect(params.ctx).toEqual({
      ...DEFAULT_SIM_CONTEXT,
      members: false,
      ringOfWealth: true,
      onKonarTask: true,
      questsComplete: ['Dragon Slayer', "Legends' Quest"],
      killCount: 50,
      variant: 'hard',
    })
    expect(params.seed).toBe(7)
    expect(params.kills).toBe(5000)
  })

  it('clamps an oversized n= to MAX_KILLS, so a crafted link cannot lock up the tab', () => {
    const params = paramsFromSearch(new URLSearchParams('n=999999999999'))
    expect(params.kills).toBe(MAX_KILLS)
  })
})

describe('the random-seed sentinel', () => {
  it('defaults to 0, which means "roll one per run"', () => {
    expect(DEFAULT_SEED).toBe(RANDOM_SEED)
    expect(RANDOM_SEED).toBe(0)
    expect(paramsFromSearch(new URLSearchParams()).seed).toBe(RANDOM_SEED)
  })

  it('never rolls the sentinel itself', () => {
    // A run stamped with 0 would re-roll on reload instead of reproducing,
    // which would quietly break every shared link.
    for (let i = 0; i < 500; i++) {
      const seed = rollSeed()
      expect(seed).toBeGreaterThan(0)
      expect(Number.isInteger(seed)).toBe(true)
    }
  })

  it('rolls something different across calls', () => {
    // Not a distribution test — just that it is not a constant, which is the
    // failure the old hardcoded `1` actually was.
    expect(new Set(Array.from({ length: 50 }, rollSeed)).size).toBeGreaterThan(1)
  })

  it('survives the URL round trip, so a rolled seed replays', () => {
    const rolled = rollSeed()
    const round = paramsFromSearch(
      searchFromParams({ ctx: DEFAULT_SIM_CONTEXT, seed: rolled, kills: 500, run: true })
    )
    expect(round.seed).toBe(rolled)
    expect(round.run).toBe(true)
  })
})

describe('searchFromParams', () => {
  it('omits fields that equal the default (keeps shareable URLs short)', () => {
    const search = searchFromParams({ ctx: DEFAULT_SIM_CONTEXT, seed: DEFAULT_SEED, kills: DEFAULT_KILLS, run: false })
    expect(search.has('members')).toBe(false)
    expect(search.has('row')).toBe(false)
    expect(search.get('seed')).toBe(String(DEFAULT_SEED))
    expect(search.get('n')).toBe(String(DEFAULT_KILLS))
  })

  it('round-trips through paramsFromSearch', () => {
    const original = {
      ctx: { ...DEFAULT_SIM_CONTEXT, ringOfWealth: true, onKonarTask: true, questsComplete: ['Dragon Slayer'], killCount: 12, variant: 'hard' },
      seed: 42,
      kills: 250_000,
      run: true,
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
      run: false,
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
      run: false,
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
      run: false,
    })
    expect(search.has('totaldmg')).toBe(false)
    expect([...search.keys()]).toContain('hpdmg')
    expect([...search.keys()]).toContain('shielddmg')
  })
})
