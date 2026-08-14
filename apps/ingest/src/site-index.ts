import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BossSchema } from '@osrs-loot-simulator/loot-model'
import { BOSSES_DIR } from './parse/parse-boss.js'
import { REPO_ROOT } from './snapshots/store.js'
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

export async function buildSiteIndex(
  bossesDir = BOSSES_DIR,
  tablesDir = TABLES_DIR
): Promise<SiteIndex> {
  const files = (await readdir(bossesDir)).filter((f) => f.endsWith('.json')).sort()
  const entries: SiteIndexEntry[] = []

  for (const file of files) {
    const raw = JSON.parse(await readFile(join(bossesDir, file), 'utf8'))
    const boss = BossSchema.parse(raw)
    entries.push({ slug: boss.slug, name: boss.name, aliases: boss.aliases, status: boss.status })
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
