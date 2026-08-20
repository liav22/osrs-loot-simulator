import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORMULA_IDS, IMPLEMENTED_FORMULA_IDS } from '@osrs-loot-simulator/loot-model'
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
import { listOverrideSlugs } from '../src/parse/overrides.js'

const watchlist: Watchlist = WatchlistSchema.parse({
  watchlistVersion: 1,
  entries: [
    {
      lootSourceId: 'lunar-chest',
      title: 'Lunar Chest',
      mechanic: 'without_replacement',
      detail: 'Uniques are drawn without replacement.',
      tier: 'unknown_scaling',
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
        { lootSourceId: 'x', title: 'X', mechanic: 'other', detail: 'a', tier: 'unknown_scaling' },
        { lootSourceId: 'x', title: 'X again', mechanic: 'other', detail: 'b', tier: 'unknown_scaling' },
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
    repeatable: true,
    ...overrides,
  }
}

/**
 * `dropsPage` defaults to `title`, matching the real inventory: the two differ
 * only for a reward page whose drops live somewhere other than the activity's
 * own page (Fortis Colosseum -> Rewards Chest (Fortis Colosseum)). It is
 * load-bearing here — `checkWatchlistConsistency` derives "this source's own
 * boss page" from it.
 */
function lootSourceEntry(
  overrides: Partial<Inventory['lootSources'][number]>
): Inventory['lootSources'][number] {
  const title = overrides.title ?? 'Placeholder'
  return {
    id: 'placeholder',
    title,
    dropsPage: title,
    tier: 'A',
    rowCount: 1,
    include: true,
    excludeReason: null,
    bosses: ['placeholder'],
    repeatable: true,
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
          tier: 'unknown_scaling',
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
          tier: 'unknown_scaling',
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
          tier: 'unknown_scaling',
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

  /**
   * The reward-cart/reward-pool swap had two halves, and only `blockedBy` was
   * ever guarded. These four cases cover the other half plus the way the check
   * could be disarmed entirely — see `checkWatchlistConsistency`'s comment.
   */
  describe('the half `blockedBy` cannot see', () => {
    const inventory: Inventory = InventorySchema.parse({
      inventoryVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      category: 'Category:Bosses',
      bosses: [
        bossEntry({ slug: 'wintertodt', title: 'Wintertodt', lootSourceId: 'reward-cart' }),
        bossEntry({ slug: 'tempoross', title: 'Tempoross', lootSourceId: 'reward-pool' }),
      ],
      lootSources: [
        lootSourceEntry({
          id: 'reward-cart',
          title: 'Reward Cart',
          dropsPage: 'Reward Cart',
          bosses: ['wintertodt'],
        }),
        lootSourceEntry({
          id: 'reward-pool',
          title: 'Reward pool',
          dropsPage: 'Reward pool',
          bosses: ['tempoross'],
        }),
      ],
    })

    function poolEntry(overrides: Record<string, unknown>): Watchlist {
      return WatchlistSchema.parse({
        watchlistVersion: 1,
        entries: [
          {
            lootSourceId: 'reward-pool',
            title: 'Reward pool',
            mechanic: 'point_scaled',
            detail: 'Rolls scale with reward permits earned subduing Tempoross. Needs the tempoross_points formula.',
            tier: 'unknown_scaling',
            blockedBy: ['Tempoross'],
            ...overrides,
          },
        ],
      })
    }

    it('passes the corrected entry', () => {
      expect(checkWatchlistConsistency(poolEntry({}), inventory)).toEqual([])
    })

    it('flags detail prose describing the OTHER source’s activity', () => {
      const issues = checkWatchlistConsistency(
        poolEntry({
          detail: 'Rolls scale with points earned fighting the Wintertodt. Needs the tempoross_points formula.',
          tier: 'unknown_scaling',
        }),
        inventory
      )
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("detail names boss page 'Wintertodt'")
    })

    it('flags a swapped formula id even when every other field is correct', () => {
      // The sharpest case: blockedBy, title and prose all name Tempoross, and
      // only the formula is wrong — which is precisely what "fix before wiring
      // either formula" is about.
      const issues = checkWatchlistConsistency(
        poolEntry({
          detail: 'Rolls scale with reward permits earned subduing Tempoross. Needs the wintertodt_points formula.',
          tier: 'unknown_scaling',
        }),
        inventory
      )
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("formula 'wintertodt_points'")
      expect(issues[0]?.message).toContain("maps to 'reward-cart'")
    })

    it('flags a title retitled to its own boss page, which used to disarm the check', () => {
      // With the old title-derived exclusion, `title: 'Tempoross'` removed
      // Tempoross from the expected set, so an emptied blockedBy passed clean.
      const issues = checkWatchlistConsistency(
        poolEntry({ title: 'Tempoross', blockedBy: [] }),
        inventory
      )
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.map((issue) => issue.message).join(' ')).toContain(
        "title 'Tempoross' matches neither"
      )
      expect(issues.map((issue) => issue.message).join(' ')).toContain("missing 'Tempoross'")
    })

    it('draws no conclusion from a formula with no boss page of its own', () => {
      // `toa_invocation`/`tob_points`/`cox_points` have no matching boss slug,
      // so rule 4b stays silent rather than guessing. Phrased as "computed
      // via", not "needs", so rule 5 (a separate, later rule — toa_invocation
      // is a real implementation, not a stub) has nothing to say either.
      expect(
        checkWatchlistConsistency(
          poolEntry({ detail: 'Scales with raid level, computed via the toa_invocation formula.' }),
          inventory
        )
      ).toEqual([])
    })
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
          tier: 'unknown_scaling',
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
 * Reproduces the two failure modes found when `ancient-chest`'s/
 * `monumental-chest`'s/`reward-pool`'s own `detail` was audited against the
 * codebase and found to still describe a pre-override state: a formula
 * claimed needed that had shipped, and a source whose override existed but
 * was never mentioned. Rules 1-4 above only ever cross-check the watchlist
 * against `data/_inventory.json`; nothing checked `detail` against
 * `IMPLEMENTED_FORMULA_IDS` or `data/overrides/` until now.
 */
describe('checkWatchlistConsistency: rules 5-6 (detail checked against the codebase)', () => {
  const inventory: Inventory = InventorySchema.parse({
    inventoryVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    category: 'Category:Bosses',
    bosses: [bossEntry({ slug: 'placeholder', title: 'Placeholder', lootSourceId: 'placeholder' })],
    lootSources: [
      lootSourceEntry({ id: 'placeholder', title: 'Placeholder', bosses: ['placeholder'] }),
    ],
  })

  function placeholderEntry(detail: string): Watchlist {
    return WatchlistSchema.parse({
      watchlistVersion: 1,
      entries: [
        {
          lootSourceId: 'placeholder',
          title: 'Placeholder',
          mechanic: 'point_scaled',
          detail,
          tier: 'unknown_scaling',
          blockedBy: [],
        },
      ],
    })
  }

  describe('rule 5: a formula claimed needed that is already implemented', () => {
    it('flags it', () => {
      const implementedId = [...IMPLEMENTED_FORMULA_IDS][0]
      expect(implementedId).toBeDefined()
      const watchlist = placeholderEntry(
        `Unique chance scales with points — needs the ${implementedId} formula.`
      )

      const issues = checkWatchlistConsistency(watchlist, inventory)
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain(`formula '${implementedId}'`)
      expect(issues[0]?.message).toContain('already')
    })

    it('stays quiet for a formula genuinely still a stub (reward-pool/reward-cart\'s real shape)', () => {
      const stubId = FORMULA_IDS.find((id) => !IMPLEMENTED_FORMULA_IDS.has(id))
      expect(stubId).toBeDefined()
      const watchlist = placeholderEntry(`Rolls scale with points — needs the ${stubId} formula.`)

      expect(checkWatchlistConsistency(watchlist, inventory)).toEqual([])
    })

    it('stays quiet when a formula is named as already implemented, not claimed needed', () => {
      const implementedId = [...IMPLEMENTED_FORMULA_IDS][0]
      const watchlist = placeholderEntry(
        `Modelled via the ${implementedId} formula, wiki-verified against the page's own figures.`
      )

      expect(checkWatchlistConsistency(watchlist, inventory)).toEqual([])
    })
  })

  describe('rule 6: a source whose override exists but is never mentioned', () => {
    it('flags it', () => {
      const watchlist = placeholderEntry('Unique chance scales with points earned across the raid.')

      const issues = checkWatchlistConsistency(watchlist, inventory, new Set(['placeholder']))
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain('data/overrides/placeholder.json exists')
    })

    it('stays quiet when the entry cites its own override path', () => {
      const watchlist = placeholderEntry(
        'MOSTLY MODELLED — data/overrides/placeholder.json models the unique roll exactly.'
      )

      expect(
        checkWatchlistConsistency(watchlist, inventory, new Set(['placeholder']))
      ).toEqual([])
    })

    it('stays quiet when no override exists for the source at all', () => {
      const watchlist = placeholderEntry('Unique chance scales with points earned across the raid.')

      expect(checkWatchlistConsistency(watchlist, inventory, new Set())).toEqual([])
    })
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
  it('has no drift between blockedBy and the real inventory, or against the real overrides/formulas (rules 5-6)', async () => {
    const realWatchlist = WatchlistSchema.parse(JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8')))
    const realInventory: Inventory = InventorySchema.parse(
      JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
    )
    const realOverrideSlugs = new Set(await listOverrideSlugs())

    expect(checkWatchlistConsistency(realWatchlist, realInventory, realOverrideSlugs)).toEqual([])
  })
})
