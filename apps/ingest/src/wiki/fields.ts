/**
 * Every piece of wiki field-name knowledge in the project lives here
 * (PROJECT_PLAN.md 6.1). Weird Gloop documents Bucket's schema as unstable, so
 * when it drifts this is the only file that should need editing.
 *
 * VERIFIED against the live wiki on 2026-08-11:
 *
 *   - There is NO bucket named `drops`. Section 6.1's example query returns
 *     `{"error":"Bucket drops does not exist."}`. The drops bucket is
 *     `dropsline`.
 *   - `dropsline` declares only three fields: `item_name` (PAGE),
 *     `drop_json` (TEXT, unindexed) and `rare_drop_table` (BOOLEAN), plus the
 *     implicit `page_name`. There are no top-level `item`, `quantity` or
 *     `rarity` columns — quantity and rarity live inside the `drop_json` blob.
 *   - Bucket schemas are browsable at namespace 9592 (`Bucket:`); the schema
 *     for a bucket is the JSON content of its `Bucket:<Name>` page.
 *
 * Re-verify by running `ingest verify-schema`, which re-fetches the bucket
 * schema pages and diffs them against the constants below.
 */

/** Bucket holding one row per drop-table line. Lowercased in queries. */
export const DROPS_BUCKET = 'dropsline'

/** Bucket namespace id, for enumerating available buckets. */
export const BUCKET_NAMESPACE = 9592

/**
 * Item id lookup. Caps at 5,000 rows per query regardless of `limit`; paging
 * needs `.offset(N)`, which the live wiki accepts (verified 2026-08-11).
 * `id` is an array — usually one element, but a page whose id does not
 * resolve to a single number (many clue scroll tiers share one page) returns
 * `["N/A"]`, and some pages legitimately carry more than one id.
 */
export const ITEM_ID_BUCKET = 'item_id'
export const ITEM_ID_PAGE_SIZE = 5000

/**
 * `infobox_item` has one row per ITEM VERSION, not one row per wiki page —
 * `item_name` is the exact display name (e.g. "Prayer potion(3)"), distinct
 * from `page_name` (e.g. "Prayer potion", the shared base page all four
 * doses live on). `item_name` matches a `{{DropsLine|name=...}}` value
 * one-to-one for versioned items, where `item_id`'s `page_name` collapses
 * every version onto one page and cannot be resolved by name alone.
 * `item_id` stays useful as a fallback for items with no `infobox_item` row.
 * Same 5,000-row cap and `.offset()` paging as `item_id` (verified
 * 2026-08-11, ~15,000-16,000 total rows).
 */
export const ITEM_NAME_BUCKET = 'infobox_item'
export const ITEM_NAME_PAGE_SIZE = 5000

/** Columns selectable on `dropsline`. */
export const DROPSLINE_FIELDS = {
  pageName: 'page_name',
  itemName: 'item_name',
  dropJson: 'drop_json',
  rareDropTable: 'rare_drop_table',
} as const

/** Keys observed inside the `drop_json` blob. */
export const DROP_JSON_FIELDS = {
  droppedFrom: 'Dropped from',
  droppedItem: 'Dropped item',
  rarity: 'Rarity',
  altRarity: 'Alt Rarity',
  altRarityDash: 'Alt Rarity Dash',
  approx: 'Approx',
  rolls: 'Rolls',
  dropQuantity: 'Drop Quantity',
  quantityLow: 'Quantity Low',
  quantityHigh: 'Quantity High',
  dropValue: 'Drop Value',
  dropLevel: 'Drop level',
  dropType: 'Drop type',
  nameNotes: 'Name Notes',
  rarityNotes: 'Rarity Notes',
  leagueRegion: 'League region',
} as const

/** Bucket schema pages fetched by `verify-schema`. */
export const SCHEMA_PAGES = [
  'Bucket:Dropsline',
  'Bucket:Drop table sources',
  'Bucket:Item id',
  'Bucket:Infobox monster',
] as const

/**
 * The category the boss inventory is drawn from. The inventory is whatever this
 * category returns — never a hand-written list.
 */
export const BOSS_CATEGORY = 'Category:Bosses'

/**
 * Markers the wiki renders in `Name Notes` / `Rarity Notes` to interleave
 * members and free-to-play variants in a single table (6.5 heuristic 2). The
 * live markup is `<sub title="Members-only" …>(m)</sub>`.
 */
export const VARIANT_MARKERS = {
  members: /\(m\)|title="Members-only"/i,
  freeToPlay: /\(f\)|title="Free-to-play"/i,
} as const

/** Rarity strings that are not fractions. */
export const ALWAYS_RARITY = /^always$/i
export const FRACTION_RARITY = /^~?\s*([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)$/
