import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'

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
