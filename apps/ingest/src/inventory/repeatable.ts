import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'
import type { Inventory } from './schema.js'

/**
 * `repeatable`: can the same account generate more than one independent roll
 * against this loot source, ever — false for a boss fought once during a
 * quest and never again (Bouncer, Sigmund, Dad). A loot simulator has nothing
 * meaningful to say about a source you can only sample once; see
 * docs/DECISIONS.md's tier-E-repeatability entry for the corpus audit this
 * was built against.
 *
 * The default signal is `Category:Quest monsters` / `Category:Quest NPCs`
 * membership (live `action=query&prop=categories` data, already fetched for
 * every inventory page by `buildInventory` — no extra request). It is a good
 * default, not a perfect one: checked against all 30 `include: true` pages
 * carrying either category, it correctly flags 29 of 30 one-time encounters
 * (cross-checked against each page's own prose — several state it outright,
 * e.g. Giant Sea Snake: "it can only be fought once"). The one false positive
 * is a quest that GATES access to an otherwise ordinary, persistent boss
 * rather than being consumed by it — Vorkath, corrected below.
 *
 * Two false-positive shapes were found and deliberately NOT turned into a
 * second automatic signal, because both were noisier than useful: (1) a page
 * saying a monster can be "fought again" specifically "in the Nightmare
 * Zone" (Dad, Kamil) — NMZ dream-fights don't drop the source's own loot
 * table, so this does not mean repeatable for simulation purposes; (2) a
 * within-encounter HP-reset ("must be fought again from full hitpoints" —
 * Evil Spirit; "regenerates ... and you must fight him again" —  Black
 * Knight Titan) which is not a return visit at all. Both shapes read as
 * "repeatable" to a naive phrase match and are wrong. Hand-verified instead:
 * neither needs an override entry, since the category default (false) is
 * already correct for both.
 *
 * Zero false negatives found: every `include: true` page in the corpus
 * *without* one of the two categories was checked for a small/trivial
 * document shape (a proxy for "looks like a one-off reward") and the two
 * that matched — Sir Mordred, Demonic Brutus — are both genuinely
 * repeatable per their own prose (Sir Mordred: "he will respawn shortly",
 * plus a non-instanced overworld location distinct from the quest instance;
 * Demonic Brutus: a hard-mode variant of the ordinary, repeatable `brutus`
 * source, gated by an item rather than a one-time script). Neither carries
 * either quest category, so the default (true) was already right for both.
 */

export const QUEST_CATEGORY_PATTERN = /^Quest (monsters|NPCs)$/i

export const RepeatableOverrideEntrySchema = z
  .object({
    /** Must match a real `title` in `data/_inventory.json`'s `bosses`. */
    wikiPage: z.string().min(1),
    repeatable: z.boolean(),
    /** Cite the wiki's own words — this is a correction to an automatic signal. */
    reason: z.string().min(20),
  })
  .strict()

export type RepeatableOverrideEntry = z.infer<typeof RepeatableOverrideEntrySchema>

export const RepeatableOverridesSchema = z
  .object({
    repeatableOverridesVersion: z.literal(1),
    note: z.string().optional(),
    entries: z.array(RepeatableOverrideEntrySchema),
  })
  .strict()
  .superRefine((overrides, ctx) => {
    const seen = new Set<string>()
    overrides.entries.forEach((entry, i) => {
      if (seen.has(entry.wikiPage)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate repeatable-override entry for '${entry.wikiPage}'`,
          path: ['entries', i, 'wikiPage'],
        })
      }
      seen.add(entry.wikiPage)
    })
  })

export type RepeatableOverrides = z.infer<typeof RepeatableOverridesSchema>

export const REPEATABLE_OVERRIDES_PATH = join(REPO_ROOT, 'data', 'repeatable-overrides.json')

export async function loadRepeatableOverrides(
  path = REPEATABLE_OVERRIDES_PATH
): Promise<RepeatableOverrides> {
  return RepeatableOverridesSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

/**
 * The default signal plus its one documented correction. `categoryNames` is
 * whatever `WikiClient.categoriesFor` returned for this exact page title —
 * live data, not a wikitext regex, so template-inherited categorisation is
 * seen too.
 */
export function deriveRepeatable(
  title: string,
  categoryNames: readonly string[],
  overrides: RepeatableOverrides
): boolean {
  const questTagged = categoryNames.some((name) => QUEST_CATEGORY_PATTERN.test(name))
  if (!questTagged) return true
  const override = overrides.entries.find((entry) => entry.wikiPage === title)
  return override?.repeatable ?? false
}

export interface RepeatableOverrideOrphan {
  wikiPage: string
  message: string
}

/**
 * Every override's `wikiPage` must name a real boss page — otherwise a
 * renamed or typo'd title silently stops correcting anything, the same
 * failure mode landmine #11f catalogued for the mechanics watchlist.
 */
export function checkRepeatableOverridesConsistency(
  overrides: RepeatableOverrides,
  inventory: Pick<Inventory, 'bosses'>
): RepeatableOverrideOrphan[] {
  const titles = new Set(inventory.bosses.map((boss) => boss.title))
  return overrides.entries
    .filter((entry) => !titles.has(entry.wikiPage))
    .map((entry) => ({
      wikiPage: entry.wikiPage,
      message: `'${entry.wikiPage}' matches no boss page in data/_inventory.json`,
    }))
}
