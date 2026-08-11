import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'

/**
 * `data/item-multi-id-allowlist.json` — item keys declared to legitimately
 * never resolve to a single item id.
 *
 * `bucket('item_id')` returns `["N/A"]` (or several ids) for a page that
 * covers many distinct in-game item ids at once — every clue scroll tier is
 * one wiki page representing hundreds of actual clue instances. The
 * `items_known` check must not fail on these; it also must not silently pass
 * every unresolved item, since an unresolved item is usually a real gap. The
 * allowlist is how a maintainer tells the two apart: listed here means
 * "known and expected to be unresolved", not "not checked yet".
 */

export const AllowlistEntrySchema = z
  .object({
    itemKey: z.string().min(1),
    title: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()

export type AllowlistEntry = z.infer<typeof AllowlistEntrySchema>

export const ItemAllowlistSchema = z
  .object({
    allowlistVersion: z.literal(1),
    note: z.string().optional(),
    entries: z.array(AllowlistEntrySchema),
  })
  .strict()

export type ItemAllowlist = z.infer<typeof ItemAllowlistSchema>

export const ALLOWLIST_PATH = join(REPO_ROOT, 'data', 'item-multi-id-allowlist.json')

export async function loadItemAllowlist(path = ALLOWLIST_PATH): Promise<ItemAllowlist> {
  return ItemAllowlistSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export function isAllowlisted(allowlist: ItemAllowlist, itemKey: string): boolean {
  return allowlist.entries.some((entry) => entry.itemKey === itemKey)
}
