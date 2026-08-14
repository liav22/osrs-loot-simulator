import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { FORMULA_IDS } from '@osrs-loot-simulator/loot-model'
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

/** Escapes a literal for embedding in a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `text` names `term` as a whole word. Substring matching is not good
 * enough here: a boss titled "Moon" would otherwise match the word "Moons" in
 * unrelated prose, and this check has to be quiet enough that a real hit is
 * always worth reading.
 */
function namesWholeWord(text: string, term: string): boolean {
  return new RegExp(`(^|[^\\w'])${escapeRegExp(term)}([^\\w']|$)`, 'i').test(text)
}

/** Formula ids and boss slugs spell the same subject differently. */
function normalizeSubject(value: string): string {
  return value.replace(/-/g, '_').toLowerCase()
}

/**
 * Cross-checks each watchlist entry against `data/_inventory.json`'s
 * boss -> lootSourceId map, which is the authoritative record of which boss
 * pages resolve to which loot source. Every field a watchlist entry carries is
 * hand-authored, with nothing else keeping it honest.
 *
 * This is the check that would have caught the reward-cart/reward-pool swap.
 * That bug had **two halves** — each entry's `blockedBy` named the other's
 * boss, AND each entry's `detail` described the other's activity and named the
 * other's formula (`wintertodt_points` vs `tempoross_points`). The original
 * version of this function only ever looked at `blockedBy`, so re-swapping the
 * prose alone passed clean — and the prose is where the formula id lives,
 * which is the half that actually misdirects the next person to wire one up.
 * Hence four rules, not one:
 *
 * 1. `lootSourceId` resolves against the inventory at all.
 * 2. `title` is pinned to the inventory's own `title`/`dropsPage` for that
 *    source. This is not cosmetic: `title` used to be what excluded a source's
 *    own boss page from the expected set, so an entry retitled to its boss
 *    ("Tempoross") with an emptied `blockedBy` passed vacuously — the check
 *    disarmed by the very field it trusted. The exclusion is now derived from
 *    the generated `dropsPage` instead (rule 3), and `title` is validated
 *    rather than believed.
 * 3. `blockedBy` lists exactly the other boss pages the inventory maps to this
 *    source. A loot source's own boss page is never expected: that boss carries
 *    the mechanic directly rather than being "blocked" by it (e.g.
 *    `duke-sucellus`'s `blockedBy: []`). "Its own boss page" means the boss
 *    whose title IS the source's `dropsPage` — a structural fact from generated
 *    data, not a hand-authored string.
 * 4. `detail` never names a boss page, or a formula whose subject is a boss
 *    page, belonging to a *different* loot source. Rule 4 only speaks when a
 *    formula's subject resolves to a known boss slug, so ids with no boss of
 *    their own (`toa_invocation`, `tob_points`, `cox_points`) draw no
 *    conclusion at all — the same "act only when the signal narrows
 *    unambiguously" discipline `build-tables.ts` uses for its own signals.
 */
export function checkWatchlistConsistency(
  watchlist: Watchlist,
  inventory: Inventory
): WatchlistConsistencyIssue[] {
  const issues: WatchlistConsistencyIssue[] = []
  const lootSourcesById = new Map(inventory.lootSources.map((source) => [source.id, source]))
  const ownerOfBossTitle = new Map(inventory.bosses.map((boss) => [boss.title, boss.lootSourceId]))
  const ownerOfBossSlug = new Map(inventory.bosses.map((boss) => [boss.slug, boss.lootSourceId]))

  for (const entry of watchlist.entries) {
    const source = lootSourcesById.get(entry.lootSourceId)
    if (source === undefined) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message: `lootSourceId '${entry.lootSourceId}' is not among data/_inventory.json's lootSources`,
      })
      continue
    }

    // Rule 2 — `title` is pinned, so it can never silently shrink rule 3's
    // expected set. Both spellings are legitimate and both occur in the real
    // data: `reward-cart` uses the source title, `rewards-chest-fortis-
    // colosseum` uses the drops page ("Fortis Colosseum" is the activity).
    if (entry.title !== source.title && entry.title !== source.dropsPage) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message:
          `title '${entry.title}' matches neither data/_inventory.json's title ` +
          `'${source.title}' nor its dropsPage '${source.dropsPage}'`,
      })
    }

    // Rule 3 — `blockedBy` vs the inventory, excluding this source's own boss
    // page, identified structurally by `dropsPage` rather than by `title`.
    const expected = new Set(
      inventory.bosses
        .filter((boss) => boss.lootSourceId === entry.lootSourceId)
        .map((boss) => boss.title)
        .filter((title) => title !== source.dropsPage)
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

    // Rule 4a — `detail` naming another source's boss page.
    for (const [title, owner] of ownerOfBossTitle) {
      if (owner === entry.lootSourceId) continue
      if (namesWholeWord(entry.detail, title)) {
        issues.push({
          lootSourceId: entry.lootSourceId,
          message:
            `detail names boss page '${title}', which data/_inventory.json maps to ` +
            `'${owner}', not '${entry.lootSourceId}'`,
        })
      }
    }

    // Rule 4b — `detail` naming a formula whose subject is another source's
    // boss. This is the half of the reward-cart/reward-pool swap that nothing
    // checked, and the half the watchlist exists to get right: `blockedBy` can
    // be perfect while the entry still points at the wrong formula.
    for (const formulaId of FORMULA_IDS) {
      if (!entry.detail.includes(formulaId)) continue
      const normalizedFormula = normalizeSubject(formulaId)
      for (const [slug, owner] of ownerOfBossSlug) {
        if (owner === entry.lootSourceId) continue
        const normalizedSlug = normalizeSubject(slug)
        const isSubject =
          normalizedFormula === normalizedSlug ||
          normalizedFormula.startsWith(`${normalizedSlug}_`)
        if (isSubject) {
          issues.push({
            lootSourceId: entry.lootSourceId,
            message:
              `detail names formula '${formulaId}', whose subject '${slug}' ` +
              `data/_inventory.json maps to '${owner}', not '${entry.lootSourceId}'`,
          })
        }
      }
    }
  }

  return issues
}
