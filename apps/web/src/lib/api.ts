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
  })
  .strict()

const SiteIndexResponseSchema = z
  .object({ generatedAt: z.string(), entries: z.array(SiteIndexEntrySchema) })
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

/** Every `tableRef` a fetched Boss might use — small enough (3 records) to fetch eagerly, once. */
const SHARED_TABLE_IDS = ['rare_drop_table', 'gem_drop_table', 'mega_rare_drop_table'] as const

export async function fetchSharedTables(): Promise<Map<string, Table>> {
  const entries = await Promise.all(
    SHARED_TABLE_IDS.map(async (id): Promise<readonly [string, Table] | null> => {
      try {
        return [id, SharedTableSchema.parse(await fetchJson(`tables/${id}.json`))]
      } catch {
        // Tier A/B/C sources with no tableRef never need these — absence
        // isn't an error until something actually references one.
        return null
      }
    })
  )
  return new Map(entries.filter((e): e is readonly [string, Table] => e !== null))
}
