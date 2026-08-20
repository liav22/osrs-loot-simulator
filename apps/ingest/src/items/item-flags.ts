import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'

/**
 * `data/item-flags.json` — curated per-`(bossSlug, itemKey)` facts the parser
 * cannot derive from the wiki: which items are a boss's actual unique drops,
 * and which item is its pet.
 *
 * Neither concept has a reliable structural or textual signal to derive from.
 * A rarity-threshold proxy for "unique" was tried and rejected (see
 * docs/DECISIONS.md — no threshold separates uniques from ordinary rares on
 * six real bosses, checked in both directions). The wiki's own "Uniques"
 * heading is explicitly barred as a derivation signal (docs/HANDOFF.md's
 * "What NOT to redo" — the most re-litigated question in the project's
 * history). Pet item keys have no consistent naming convention either (most
 * are `pet-*`, but e.g. Shellbane Gryphon's is `gull-pet`). So both are
 * hand-curated here, the same way `allowlist.ts` curates multi-id
 * resolution exceptions.
 *
 * Keyed by `(bossSlug, itemKey)` rather than `itemKey` alone: "unique" is
 * inherently boss-relative, and keeping "pet" on the same key shape avoids a
 * second, differently-shaped lookup for what is otherwise the same kind of
 * curated fact.
 */

export const ItemFlagSchema = z.enum(['unique', 'pet'])
export type ItemFlag = z.infer<typeof ItemFlagSchema>

export const ItemFlagEntrySchema = z
  .object({
    bossSlug: z.string().min(1),
    itemKey: z.string().min(1),
    flags: z.array(ItemFlagSchema).min(1),
    reason: z.string().min(1),
  })
  .strict()

export type ItemFlagEntry = z.infer<typeof ItemFlagEntrySchema>

export const ItemFlagsSchema = z
  .object({
    itemFlagsVersion: z.literal(1),
    note: z.string().optional(),
    entries: z.array(ItemFlagEntrySchema),
  })
  .strict()

export type ItemFlags = z.infer<typeof ItemFlagsSchema>

export const ITEM_FLAGS_PATH = join(REPO_ROOT, 'data', 'item-flags.json')

export async function loadItemFlags(path = ITEM_FLAGS_PATH): Promise<ItemFlags> {
  return ItemFlagsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

/** The curated flags for one `(bossSlug, itemKey)` pair, or an empty set when none are authored. */
export function itemFlagsFor(flags: ItemFlags, bossSlug: string, itemKey: string): Set<ItemFlag> {
  const entry = flags.entries.find((e) => e.bossSlug === bossSlug && e.itemKey === itemKey)
  return new Set(entry?.flags ?? [])
}
