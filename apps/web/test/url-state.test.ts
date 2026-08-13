import { describe, expect, it } from 'vitest'
import { DEFAULT_KILLS, DEFAULT_SEED, paramsFromSearch, searchFromParams } from '../src/lib/url-state'
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
