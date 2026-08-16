import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BossSchema } from '@osrs-loot-simulator/loot-model'
import { extractInfoboxImage } from './parse/infobox-image.js'
import { BOSSES_DIR } from './parse/parse-boss.js'
import { readSnapshot, REPO_ROOT, slugify } from './snapshots/store.js'
import { TABLES_DIR } from './tables/shared-tables.js'

/**
 * `data/index.json` (PROJECT_PLAN.md section 3): the small, eagerly-loaded
 * search index — slug/name/aliases/status only, never the full drop table.
 * Not one of `ingest`'s three named commands (`fetch`/`parse`/`report`) in
 * section 6.3, which is a spec gap rather than a decision — the frontend
 * needs this file and nothing else currently produces it, so it's a fourth
 * command (`ingest site-index`) rather than folding it into `parse` (whose
 * job is one source at a time, not a directory-wide summary pass).
 *
 * Built by reading whatever is currently in `data/bosses/*.json`, exactly
 * as `parse` left it — including the risk `plan/HANDOFF.md` landmine #6
 * already names: a stale file from a source that no longer parses is not
 * automatically removed, so it would still appear here too. Re-run
 * `ingest parse --tier <X> --all` before this if that matters.
 */

export const SiteIndexEntrySchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    status: z.enum(['verified', 'needs_review', 'manual_override']),
    /**
     * The wiki FILE NAME of the page's infobox image ("Vorkath.png"), not a
     * URL — the frontend builds a thumbnail URL at whatever width its layout
     * wants, so changing that width is not an ingest change. Optional because
     * it is read from the gitignored snapshot cache: see `buildSiteIndex`.
     */
    image: z.string().min(1).optional(),
    /**
     * Whether the same account can get more than one roll against this
     * source — false for a boss fought once during a quest and never again.
     * The document is still generated and still in the index (nothing is
     * deleted — see docs/DECISIONS.md), just excluded from the default
     * search results the way `apps/web`'s fuzzy search reads this field.
     * Defaults to `true` (matching `BossSchema`) so `committedImages` can
     * still read a `data/index.json` written before this field existed,
     * rather than silently dropping every carried-forward image the same
     * way an unparseable previous index already degrades.
     */
    repeatable: z.boolean().default(true),
  })
  .strict()

export type SiteIndexEntry = z.infer<typeof SiteIndexEntrySchema>

export const SiteIndexSchema = z
  .object({
    generatedAt: z.string(),
    entries: z.array(SiteIndexEntrySchema),
    /**
     * Every id in `data/tables/`, so the browser can fetch the shared tables
     * by reading a manifest instead of carrying its own hardcoded list.
     *
     * This exists because `apps/web/src/lib/api.ts` had exactly the bug
     * `loadSharedTables` was already fixed for (see tables/shared-tables.ts):
     * a literal `['rare_drop_table', 'gem_drop_table', 'mega_rare_drop_table']`
     * that silently stopped covering the directory the moment Lunar Chest's
     * three per-Moon set records were added. The consequence in production was
     * not a missing file — it was `UnresolvedTableRefError` thrown out of the
     * simulation worker for every Lunar Chest run with a Moon selected, plus
     * the ownership controls never rendering, because `contextSurfaceOf` had
     * no table to follow the tableRef into. `readdir` is not available in a
     * browser, so the directory listing has to be handed to it; this is that
     * listing, generated from the same directory scan ingest uses.
     */
    tables: z.array(z.string().min(1)),
  })
  .strict()

export type SiteIndex = z.infer<typeof SiteIndexSchema>

export const SITE_INDEX_PATH = join(REPO_ROOT, 'data', 'index.json')

/**
 * Whatever `data/index.json` already records for each slug's `image`.
 *
 * The wikitext snapshots this field is read from are gitignored, so a checkout
 * without them would otherwise regenerate an index that silently drops every
 * boss portrait — a data loss that no check would catch, because the field is
 * legitimately optional. Carrying the committed value forward makes a
 * snapshot-less regeneration a no-op for this field instead.
 */
async function committedImages(path: string): Promise<Map<string, string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    const previous = SiteIndexSchema.parse(raw)
    return new Map(
      previous.entries.flatMap((e) => (e.image === undefined ? [] : [[e.slug, e.image] as const]))
    )
  } catch {
    // No index yet, or one this version can't read. Either way there is
    // nothing to preserve, which is not an error.
    return new Map()
  }
}

/** The page's infobox image, from the snapshot cache, falling back to the committed value. */
async function imageFor(boss: { slug: string; wikiPage: string }, previous: Map<string, string>) {
  try {
    const snapshot = await readSnapshot('wikitext', slugify(boss.wikiPage))
    const body = snapshot.body as { parse?: { wikitext?: unknown } } | undefined
    const wikitext = body?.parse?.wikitext
    if (typeof wikitext === 'string') {
      const image = extractInfoboxImage(wikitext)
      if (image !== undefined) return image
    }
  } catch {
    // No snapshot on this machine — fall through to what's already committed.
  }
  return previous.get(boss.slug)
}

export async function buildSiteIndex(
  bossesDir = BOSSES_DIR,
  tablesDir = TABLES_DIR,
  indexPath = SITE_INDEX_PATH
): Promise<SiteIndex> {
  const files = (await readdir(bossesDir)).filter((f) => f.endsWith('.json')).sort()
  const previousImages = await committedImages(indexPath)
  const entries: SiteIndexEntry[] = []

  for (const file of files) {
    const raw = JSON.parse(await readFile(join(bossesDir, file), 'utf8'))
    const boss = BossSchema.parse(raw)
    const image = await imageFor(boss, previousImages)
    entries.push({
      slug: boss.slug,
      name: boss.name,
      aliases: boss.aliases,
      status: boss.status,
      repeatable: boss.repeatable,
      ...(image === undefined ? {} : { image }),
    })
  }

  // Same directory scan `loadSharedTables` does, and for the same reason. The
  // id/filename equality it enforces is what makes deriving ids from file
  // names here safe rather than a second source of truth.
  const tables = (await readdir(tablesDir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()

  return SiteIndexSchema.parse({ generatedAt: new Date().toISOString(), entries, tables })
}

export async function writeSiteIndex(index: SiteIndex, path = SITE_INDEX_PATH): Promise<void> {
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}
