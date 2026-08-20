import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { FORMULA_IDS, IMPLEMENTED_FORMULA_IDS, type FormulaId } from '@osrs-loot-simulator/loot-model'
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

/**
 * Which of the web app's two watchlist-driven status tiers (`apps/web/src/
 * lib/tier.ts`) an entry belongs to — hand-set per entry because it is an
 * editorial judgement `mechanic`/`detail` cannot express mechanically:
 * `'approximate'` means an override already models the mechanic and the
 * remaining residual is a named, bounded simplification (the four raids —
 * ToA's five remnant challenge rewards, CoX's per-player-not-per-party
 * approximation, ToB's team allocation, Fortis's with-replacement armour
 * dedup); `'unknown_scaling'` means the wiki names a rule and never states
 * the function needed to model it at all (Zalcano's two curves, Reward
 * cart/pool's point formulas, Duke Sucellus' unbuilt roll-chain). See
 * `docs/DECISIONS.md`'s status-tier entry before changing an existing entry's
 * value — it is a claim about how close the source is to done, not a
 * classification of the mechanic type.
 */
export const WATCHLIST_TIERS = ['approximate', 'unknown_scaling'] as const
export const WatchlistTierSchema = z.enum(WATCHLIST_TIERS)
export type WatchlistTier = z.infer<typeof WatchlistTierSchema>

export const WatchlistEntrySchema = z
  .object({
    lootSourceId: z.string().min(1),
    title: z.string().min(1),
    mechanic: MechanicSchema,
    detail: z.string().min(1),
    tier: WatchlistTierSchema,
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
 *
 * Rules 5 and 6 exist for a *different* bug, found later: six of the eight
 * `detail` fields turned out to be describing a PRE-OVERRIDE state on a
 * source that had since shipped one — `monumental-chest` and `ancient-chest`
 * both still claimed to need a formula (`tob_points`, `cox_points`) that had
 * been a real implementation, not a stub, for a session or more; `detail` is
 * what a user reads as the reason a source is `needs_review`, so a stale
 * claim there is actively misleading, not merely untidy. Nothing compared
 * this prose to the codebase until now. Deliberately narrow — this catches
 * the two SPECIFIC shapes that actually went wrong, not prose drift in
 * general, which cannot be checked mechanically without false positives.
 *
 * Hence six rules, not one:
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
 * 5. `detail` never claims a formula ("needs the X formula") is still needed
 *    when `IMPLEMENTED_FORMULA_IDS` already has it. Narrow on the exact
 *    phrasing this project's own entries use for the claim
 *    (`formulaIdsClaimedNeeded`'s `NEEDS_FORMULA_PATTERN`) — a formula
 *    mentioned any other way (e.g. "models ... (cox_points: ...)", stating
 *    what it does) is not this claim and is correctly not matched.
 * 6. `detail` never omits its own shipped override. When
 *    `data/overrides/<lootSourceId>.json` exists (`overrideSlugs`, passed by
 *    the caller — this function stays pure, no filesystem access here),
 *    `detail` must cite that path literally. Every entry that accurately
 *    describes a shipped override already does this as a matter of house
 *    style (`data/overrides/ancient-chest.json`, `.../zalcano.json`, ...);
 *    an entry that doesn't is the same "written before the override existed,
 *    never revisited" shape as the six that had to be rewritten.
 */
/**
 * Matches "needs the X formula" (and "needing"/"needed", an optional "the",
 * and an optional "still-stub"/"a new" qualifier) and captures the
 * identifier — the exact phrasing every stale entry this project has shipped
 * so far used for the claim (`Needs the wintertodt_points formula.`, `needs
 * the tob_points formula`). Requires at least one underscore in the
 * identifier, matching every real `FormulaId`'s own naming convention, so it
 * does not fire on ordinary English ("needs a new formula" with no id).
 */
const NEEDS_FORMULA_PATTERN =
  /\bneed(?:s|ing|ed)?\s+(?:the\s+)?(?:still-stub\s+|a\s+new\s+)?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s+formula\b/gi

/** The `FormulaId`s an entry's own `detail` claims are still needed, per `NEEDS_FORMULA_PATTERN`. */
function formulaIdsClaimedNeeded(detail: string): FormulaId[] {
  const found: FormulaId[] = []
  for (const match of detail.matchAll(NEEDS_FORMULA_PATTERN)) {
    const candidate = match[1]?.toLowerCase()
    if (candidate !== undefined && (FORMULA_IDS as readonly string[]).includes(candidate)) {
      found.push(candidate as FormulaId)
    }
  }
  return found
}

export function checkWatchlistConsistency(
  watchlist: Watchlist,
  inventory: Inventory,
  /** Loot source ids with a `data/overrides/<id>.json` file — rule 6. Empty by default so every existing caller/test that doesn't care about override-existence needs no change. */
  overrideSlugs: ReadonlySet<string> = new Set()
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

    // Rule 5 — `detail` claims a formula is still needed when it is already
    // implemented. This is the CoX/ToB staleness shape exactly: true when
    // written, never re-checked once the formula shipped.
    for (const formulaId of formulaIdsClaimedNeeded(entry.detail)) {
      if (IMPLEMENTED_FORMULA_IDS.has(formulaId)) {
        issues.push({
          lootSourceId: entry.lootSourceId,
          message:
            `detail claims formula '${formulaId}' is still needed, but ` +
            `IMPLEMENTED_FORMULA_IDS already has it (not a stub) — detail is likely stale`,
        })
      }
    }

    // Rule 6 — `detail` never mentions its own override, even though
    // data/overrides/<lootSourceId>.json exists. The other half of the same
    // staleness shape: a source can ship an override that makes rule 5's
    // specific formula claim technically still true (reward-pool's
    // tempoross_points really is still a stub) while the rest of the entry
    // still describes a document that no longer exists.
    const overridePath = `data/overrides/${entry.lootSourceId}.json`
    if (overrideSlugs.has(entry.lootSourceId) && !entry.detail.includes(overridePath)) {
      issues.push({
        lootSourceId: entry.lootSourceId,
        message: `${overridePath} exists, but detail never mentions it — detail likely describes a pre-override state`,
      })
    }
  }

  return issues
}
