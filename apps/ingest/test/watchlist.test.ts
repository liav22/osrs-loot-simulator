import { describe, expect, it } from 'vitest'
import { checkNotOnWatchlist, watchlistEntryFor, WatchlistSchema, type Watchlist } from '../src/validate/watchlist.js'

const watchlist: Watchlist = WatchlistSchema.parse({
  watchlistVersion: 1,
  entries: [
    {
      lootSourceId: 'lunar-chest',
      title: 'Lunar Chest',
      mechanic: 'without_replacement',
      detail: 'Uniques are drawn without replacement.',
      blockedBy: ['Blood Moon'],
    },
  ],
})

describe('checkNotOnWatchlist', () => {
  it('passes a loot source that is not on the watchlist', () => {
    const result = checkNotOnWatchlist(watchlist, 'branda-the-fire-queen')
    expect(result).toEqual({ check: 'not_on_watchlist', ok: true })
  })

  it('fails a loot source that IS on the watchlist, naming the mechanic', () => {
    const result = checkNotOnWatchlist(watchlist, 'lunar-chest')
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('without_replacement: Uniques are drawn without replacement.')
  })
})

describe('watchlistEntryFor', () => {
  it('finds the entry by lootSourceId', () => {
    expect(watchlistEntryFor(watchlist, 'lunar-chest')?.mechanic).toBe('without_replacement')
  })

  it('returns null for a source not on the list', () => {
    expect(watchlistEntryFor(watchlist, 'brutus')).toBeNull()
  })
})

describe('WatchlistSchema', () => {
  it('rejects a duplicate lootSourceId', () => {
    const result = WatchlistSchema.safeParse({
      watchlistVersion: 1,
      entries: [
        { lootSourceId: 'x', title: 'X', mechanic: 'other', detail: 'a' },
        { lootSourceId: 'x', title: 'X again', mechanic: 'other', detail: 'b' },
      ],
    })
    expect(result.success).toBe(false)
  })
})
