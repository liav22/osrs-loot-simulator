import { z } from 'zod'
import { BossSchema, SharedTableSchema, type Boss, type Table } from '@osrs-loot-simulator/loot-model'
import type { SiteIndex } from './types'

/**
 * Every fetch here is a runtime `fetch()` against `public/*.json`
 * (apps/web/scripts/sync-data.mjs's copy of committed `data/`), resolved
 * against `import.meta.env.BASE_URL` so it works identically in dev and on
 * GitHub Pages' subpath. PROJECT_PLAN.md 9: "Never `import` the boss JSON
 * into the bundle... fetch at runtime" — every one of these functions is
 * the reason that constraint is met.
 */

const SiteIndexEntrySchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string()),
    status: z.enum(['verified', 'needs_review', 'manual_override']),
    // Optional here for the same reason it is optional in ingest's schema: it
    // comes from the gitignored snapshot cache. `.strict()` means this must be
    // declared, not merely tolerated — an index carrying it would otherwise be
    // rejected outright.
    image: z.string().min(1).optional(),
  })
  .strict()

const SiteIndexResponseSchema = z
  .object({
    generatedAt: z.string(),
    entries: z.array(SiteIndexEntrySchema),
    tables: z.array(z.string().min(1)),
  })
  .strict()

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(assetUrl(path))
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export async function fetchSiteIndex(): Promise<SiteIndex> {
  return SiteIndexResponseSchema.parse(await fetchJson('index.json'))
}

export async function fetchBoss(slug: string): Promise<Boss> {
  return BossSchema.parse(await fetchJson(`bosses/${slug}.json`))
}

/**
 * Every `tableRef` a fetched Boss might use — small enough to fetch eagerly,
 * once, for the whole session.
 *
 * `ids` comes from the site index's `tables` manifest, NOT from a literal here.
 * A literal is what this was, and it was wrong: it named the three Phase 3 RDT
 * records and never learned about Lunar Chest's three `lunar_chest_*_set`
 * tables, so in the browser every Lunar Chest run with a Moon selected threw
 * `UnresolvedTableRefError` out of the worker and the ownership controls never
 * rendered. jsdom never saw it because `test/SimContextControls.test.tsx`
 * builds its map by reading the directory, which is a path the browser cannot
 * take. `apps/ingest/src/tables/shared-tables.ts` had already been fixed for
 * the identical bug; this is the same fix on the other side of the wire.
 */
export async function fetchSharedTables(ids: readonly string[]): Promise<Map<string, Table>> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<readonly [string, Table] | null> => {
      try {
        return [id, SharedTableSchema.parse(await fetchJson(`tables/${id}.json`))]
      } catch {
        // A record listed in the manifest but unreadable is a deploy problem,
        // not a per-boss one — sources that never reference it are unaffected,
        // and one that does fails loudly at simulate time.
        return null
      }
    })
  )
  return new Map(entries.filter((e): e is readonly [string, Table] => e !== null))
}
