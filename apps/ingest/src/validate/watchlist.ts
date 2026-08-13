import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'
import { InventorySchema, type Inventory } from '../inventory/schema.js'
import { INVENTORY_PATH } from '../inventory/build.js'

/**
 * The mechanics watchlist.
 *
 * Some loot sources have a mechanic that simply is not present in their drop
 * rows — uniques drawn without replacement, rolls that scale with activity
 * points. Those sources can parse perfectly and still be wrong, because the
 * rows never encoded the thing that matters. Parsing cleanly is therefore not
 * evidence of correctness for them.
 *
 * `not_on_watchlist` fails for any source listed here, which forces
 * `status: 'needs_review'` regardless of every other check passing. It is a
 * deliberate refusal to mark something verified on the strength of a signal
 * that cannot see the problem.
 */

export const MECHANICS = ['without_replacement', 'point_scaled', 'kc_scaled', 'other'] as const
export const MechanicSchema = z.enum(MECHANICS)
export type Mechanic = z.infer<typeof MechanicSchema>

export const WatchlistEntrySchema = z
  .object({
    lootSourceId: z.string().min(1),
    title: z.string().min(1),
    mechanic: MechanicSchema,
    detail: z.string().min(1),
    /** Pages whose results depend on this mechanic, for the report. */
    blockedBy: z.array(z.string().min(1)).default([]),
  })
  .strict()

export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>

export const WatchlistSchema = z
  .object({
    watchlistVersion: z.literal(1),
    note: z.string().optional(),
    entries: z.array(WatchlistEntrySchema),
  })
  .strict()
  .superRefine((watchlist, ctx) => {
    const seen = new Set<string>()
    watchlist.entries.forEach((entry, i) => {
      if (seen.has(entry.lootSourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate watchlist entry for '${entry.lootSourceId}'`,
          path: ['entries', i, 'lootSourceId'],
        })
      }
      seen.add(entry.lootSourceId)
    })
  })

export type Watchlist = z.infer<typeof WatchlistSchema>

export const WATCHLIST_PATH = join(REPO_ROOT, 'data', 'mechanics-watchlist.json')

export async function loadWatchlist(path = WATCHLIST_PATH): Promise<Watchlist> {
  return WatchlistSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export async function loadInventoryForWatchlistCheck(
  path = INVENTORY_PATH
): Promise<Inventory> {
  return InventorySchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export function watchlistEntryFor(
  watchlist: Watchlist,
  lootSourceId: string
): WatchlistEntry | null {
  return watchlist.entries.find((entry) => entry.lootSourceId === lootSourceId) ?? null
}

/**
 * The `not_on_watchlist` check. Passes when the source is absent from the
 * watchlist; fails, with the mechanic named, when it is present.
 */
export function checkNotOnWatchlist(
  watchlist: Watchlist,
  lootSourceId: string
): { check: 'not_on_watchlist'; ok: boolean; detail?: string } {
  const entry = watchlistEntryFor(watchlist, lootSourceId)
  if (entry === null) return { check: 'not_on_watchlist', ok: true }
  return {
    check: 'not_on_watchlist',
    ok: false,
    detail: `${entry.mechanic}: ${entry.detail}`,
  }
}

export type WatchlistConsistencyIssue = {
  lootSourceId: string
  message: string
}

/**
 * Cross-checks each watchlist entry's `blockedBy` against
 * `data/_inventory.json`'s boss -> lootSourceId map, which is the
 * authoritative record of which boss pages resolve to which loot source.
 * `blockedBy` is hand-authored prose with nothing else keeping it honest —
 * this is the check that would have caught the reward-cart/reward-pool swap
 * (each entry named the other's boss).
 *
 * A loot source's own boss page (the inventory boss whose `title` equals the
 * watchlist entry's `title`) is never expected in `blockedBy`: that boss
 * carries the mechanic directly rather than being "blocked" by it, matching
 * every existing entry's convention (e.g. `duke-sucellus`'s `blockedBy: []`,
 * since Duke Sucellus is its own loot source with no other boss sharing it).
 */
export function checkWatchlistConsistency(
  watchlist: Watchlist,
  inventory: Inventory
): WatchlistConsistencyIssue[] {
  const issues: WatchlistConsistencyIssue[] = []
  const knownLootSourceIds = new Set(inventory.lootSources.map((source) => source.id))

  for (const entry of watchlist.entries) {
    if (!knownLootSourceIds.has(entry.lootSourceId)) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message: `lootSourceId '${entry.lootSourceId}' is not among data/_inventory.json's lootSources`,
      })
      continue
    }

    const expected = new Set(
      inventory.bosses
        .filter((boss) => boss.lootSourceId === entry.lootSourceId)
        .map((boss) => boss.title)
        .filter((title) => title !== entry.title)
    )
    const actual = new Set(entry.blockedBy)

    const missing = [...expected].filter((title) => !actual.has(title))
    const extra = [...actual].filter((title) => !expected.has(title))

    if (missing.length > 0) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message:
          `blockedBy is missing ${missing.map((title) => `'${title}'`).join(', ')} ` +
          `(data/_inventory.json maps ${missing.length === 1 ? 'it' : 'them'} to '${entry.lootSourceId}', but blockedBy does not list ${missing.length === 1 ? 'it' : 'them'})`,
      })
    }
    if (extra.length > 0) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message:
          `blockedBy lists ${extra.map((title) => `'${title}'`).join(', ')}, which ` +
          `data/_inventory.json does not map to '${entry.lootSourceId}'`,
      })
    }
  }

  return issues
}
