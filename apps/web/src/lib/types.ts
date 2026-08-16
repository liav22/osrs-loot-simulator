/** `data/index.json` — mirrors apps/ingest/src/site-index.ts's SiteIndexSchema. */
export interface SiteIndexEntry {
  slug: string
  name: string
  aliases: string[]
  status: 'verified' | 'needs_review' | 'manual_override'
  /**
   * Wiki file name of the page's infobox image ("Vorkath.png"). Optional
   * because `buildSiteIndex` reads it from the gitignored snapshot cache —
   * `BossPanel` renders a placeholder box of the same size when it is absent,
   * so the layout is identical either way.
   */
  image?: string
  /**
   * Whether the same account can get more than one roll against this source
   * — false for a boss fought once during a quest and never again.
   * `SearchBox` excludes these by default; `/admin` does not, on purpose.
   */
  repeatable: boolean
}

export interface SiteIndex {
  generatedAt: string
  entries: SiteIndexEntry[]
  /** Every id in `data/tables/` — the manifest `fetchSharedTables` fetches by. */
  tables: string[]
}
