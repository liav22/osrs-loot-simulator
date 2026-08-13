/** `data/index.json` — mirrors apps/ingest/src/site-index.ts's SiteIndexSchema. */
export interface SiteIndexEntry {
  slug: string
  name: string
  aliases: string[]
  status: 'verified' | 'needs_review' | 'manual_override'
}

export interface SiteIndex {
  generatedAt: string
  entries: SiteIndexEntry[]
}
