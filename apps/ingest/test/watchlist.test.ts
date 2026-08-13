import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkNotOnWatchlist,
  checkWatchlistConsistency,
  watchlistEntryFor,
  WatchlistSchema,
  WATCHLIST_PATH,
  type Watchlist,
} from '../src/validate/watchlist.js'
import { InventorySchema, type Inventory } from '../src/inventory/schema.js'
import { INVENTORY_PATH } from '../src/inventory/build.js'

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

function bossEntry(overrides: Partial<Inventory['bosses'][number]>): Inventory['bosses'][number] {
  return {
    slug: 'placeholder',
    title: 'Placeholder',
    pageid: 1,
    revid: 1,
    lootSourceId: 'placeholder',
    classification: 'own-table',
    tier: 'A',
    rowCount: 1,
    encounter: null,
    ...overrides,
  }
}

function lootSourceEntry(
  overrides: Partial<Inventory['lootSources'][number]>
): Inventory['lootSources'][number] {
  return {
    id: 'placeholder',
    title: 'Placeholder',
    dropsPage: 'Placeholder',
    tier: 'A',
    rowCount: 1,
    include: true,
    excludeReason: null,
    bosses: ['placeholder'],
    ...overrides,
  }
}

describe('checkWatchlistConsistency', () => {
  it('passes when blockedBy matches the inventory exactly, excluding the source’s own boss', () => {
    const watchlist = WatchlistSchema.parse({
      watchlistVersion: 1,
      entries: [
        {
          lootSourceId: 'reward-cart',
          title: 'Reward Cart',
          mechanic: 'point_scaled',
          detail: 'Rolls scale with Wintertodt points.',
          blockedBy: ['Wintertodt'],
        },
      ],
    })
    const inventory: Inventory = InventorySchema.parse({
      inventoryVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      category: 'Category:Bosses',
      bosses: [
        bossEntry({ slug: 'wintertodt', title: 'Wintertodt', lootSourceId: 'reward-cart' }),
      ],
      lootSources: [lootSourceEntry({ id: 'reward-cart', title: 'Reward Cart', bosses: ['wintertodt'] })],
    })

    expect(checkWatchlistConsistency(watchlist, inventory)).toEqual([])
  })

  it('flags a swap: blockedBy names a boss that maps to a different loot source', () => {
    // Reproduces the real reward-cart/reward-pool bug: reward-cart's blockedBy
    // named Tempoross, but data/_inventory.json maps Tempoross to reward-pool
    // and Wintertodt to reward-cart.
    const watchlist = WatchlistSchema.parse({
      watchlistVersion: 1,
      entries: [
        {
          lootSourceId: 'reward-cart',
          title: 'Reward Cart',
          mechanic: 'point_scaled',
          detail: 'wrong, swapped with reward-pool',
          blockedBy: ['Tempoross'],
        },
      ],
    })
    const inventory: Inventory = InventorySchema.parse({
      inventoryVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      category: 'Category:Bosses',
      bosses: [
        bossEntry({ slug: 'wintertodt', title: 'Wintertodt', lootSourceId: 'reward-cart' }),
        bossEntry({ slug: 'tempoross', title: 'Tempoross', lootSourceId: 'reward-pool' }),
      ],
      lootSources: [
        lootSourceEntry({ id: 'reward-cart', title: 'Reward Cart', bosses: ['wintertodt'] }),
        lootSourceEntry({ id: 'reward-pool', title: 'Reward pool', bosses: ['tempoross'] }),
      ],
    })

    const issues = checkWatchlistConsistency(watchlist, inventory)
    expect(issues).toHaveLength(2)
    expect(issues.map((issue) => issue.message).join(' ')).toContain("missing 'Wintertodt'")
    expect(issues.map((issue) => issue.message).join(' ')).toContain("lists 'Tempoross'")
  })

  it('does not expect a loot source’s own boss page in its own blockedBy', () => {
    const watchlist = WatchlistSchema.parse({
      watchlistVersion: 1,
      entries: [
        {
          lootSourceId: 'abyssal-sire',
          title: 'Abyssal Sire',
          mechanic: 'other',
          detail: 'x2 multiplier on the rare drop table.',
          blockedBy: [],
        },
      ],
    })
    const inventory: Inventory = InventorySchema.parse({
      inventoryVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      category: 'Category:Bosses',
      bosses: [
        bossEntry({ slug: 'abyssal-sire', title: 'Abyssal Sire', lootSourceId: 'abyssal-sire' }),
      ],
      lootSources: [
        lootSourceEntry({ id: 'abyssal-sire', title: 'Abyssal Sire', bosses: ['abyssal-sire'] }),
      ],
    })

    expect(checkWatchlistConsistency(watchlist, inventory)).toEqual([])
  })

  it('flags a lootSourceId absent from data/_inventory.json entirely', () => {
    const watchlist = WatchlistSchema.parse({
      watchlistVersion: 1,
      entries: [
        {
          lootSourceId: 'no-such-source',
          title: 'Ghost',
          mechanic: 'other',
          detail: 'stale entry',
          blockedBy: [],
        },
      ],
    })
    const inventory: Inventory = InventorySchema.parse({
      inventoryVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      category: 'Category:Bosses',
      bosses: [bossEntry({})],
      lootSources: [lootSourceEntry({})],
    })

    const issues = checkWatchlistConsistency(watchlist, inventory)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('not among data/_inventory.json')
  })
})

/**
 * Reads the real, committed `data/mechanics-watchlist.json` and
 * `data/_inventory.json` and asserts they agree. This is the regression test
 * for the reward-cart/reward-pool swap: both files are checked in, so this
 * runs in every `pnpm -r test`/CI invocation, not just on a machine that has
 * regenerated `_inventory.json` locally.
 */
const bothPresent = existsSync(WATCHLIST_PATH) && existsSync(INVENTORY_PATH)

describe.skipIf(!bothPresent)('data/mechanics-watchlist.json vs data/_inventory.json', () => {
  it('has no drift between blockedBy and the real inventory', () => {
    const realWatchlist = WatchlistSchema.parse(JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8')))
    const realInventory: Inventory = InventorySchema.parse(
      JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
    )

    expect(checkWatchlistConsistency(realWatchlist, realInventory)).toEqual([])
  })
})
