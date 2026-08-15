import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BossSchema, SharedTableSchema, type Node } from '@osrs-loot-simulator/loot-model'
import { readSnapshot, slugify, snapshotPath, writeSnapshot, REPO_ROOT } from '../snapshots/store.js'
import { FileSearchResponseSchema, ImageInfoResponseSchema } from '../wiki/schemas.js'
import type { WikiClient } from '../wiki/client.js'

/**
 * Resolves every corpus item to the wiki file its inventory icon actually
 * lives in, so the frontend can stop guessing.
 *
 * ## Why this exists
 *
 * The frontend derived icon URLs from the item name — `/images/{Name}.png` —
 * and an audit over all 693 distinct items in the parsed corpus put the miss
 * rate at **13.6% (94 items)**. Not scattered noise: one structural class.
 * Every stackable item's icon file carries a stack-size suffix the item name
 * never mentions (`Acorn` is `Acorn 5.png`, `Coins` is `Coins 100.png`,
 * `Ancient essence` is `Ancient essence 500.png`, `Cow slippers` is
 * `Cow slippers (1).png`). The suffix varies, so no rule over the name
 * produces it, and the class covers every seed, arrow, bolt and shard — the
 * highest-count items in any results grid.
 *
 * A `Special:FilePath` fallback in the browser papered over most of it, at the
 * cost of a second request per miss against a MediaWiki special page that
 * rate-limits (the audit hit HTTP 429). Resolving once, here, and shipping the
 * answer is strictly better: the browser makes one request per icon, to the
 * CDN, and it is always the right one.
 *
 * ## Two stages, because one API does not cover it
 *
 * 1. **`prop=imageinfo` over `File:{Name}.png`, 50 titles per request.**
 *    MediaWiki resolves file redirects here, which is what turns
 *    `File:Acorn.png` into `Acorn 5.png`. 676 of 693.
 * 2. **`list=search&srnamespace=6` for whatever stage 1 reports missing.**
 *    These are case-only mismatches on proper nouns — `Baby mole` is filed as
 *    `Baby Mole.png`, `Wine of zamorak` as `Wine of Zamorak.png`, `Vet'ion
 *    jr.` as `Vet'ion Jr..png` — and which words a proper noun capitalises is
 *    not a function of the item name. Search is case-insensitive, so it finds
 *    them; **only a case-insensitive EXACT title match is accepted**, never a
 *    ranked first hit. That distinction is the whole safety of this stage:
 *    searching `Baby mole` also returns `Baby Mole (NPC).png` and
 *    `Baby Mole detail.png`, and accepting a best guess would silently ship
 *    the wrong picture. 16 of the remaining 17.
 *
 * One item survives both stages — `Muphin`, whose icon the wiki only has as
 * `(shielded)`/`(melee)`/`(ranged)` variants with no plain file. It is
 * recorded in `unresolved` rather than guessed at, and renders a placeholder.
 *
 * ## Snapshot-first
 *
 * Every response is written to `data/snapshots/item-icon/` and every later
 * read comes from there. Re-running this command after the snapshots exist
 * makes no network requests at all, so fixing a bug in the extraction below
 * never re-hits the wiki (CLAUDE.md's hard rule). Rate limiting is the
 * `WikiClient`'s: serialised, one request at a time, with the standard delay,
 * maxlag and retry handling.
 */

export const ITEM_ICONS_VERSION = 1
export const ITEM_ICONS_PATH = join(REPO_ROOT, 'data', 'item-icons.json')

/** `imageinfo` accepts 50 titles per request for anonymous clients. */
const TITLES_PER_REQUEST = 50

export const ItemIconsSchema = z
  .object({
    itemIconsVersion: z.literal(ITEM_ICONS_VERSION),
    generatedAt: z.string(),
    /**
     * Item name -> wiki file NAME (`"Acorn 5.png"`), not a URL. The frontend
     * builds the URL, so its encoding and any future thumbnailing are
     * presentation decisions that do not require an ingest run. Deliberately
     * not the `imageinfo` URL verbatim: that carries a `?hash` cache-buster
     * which changes whenever the image is re-uploaded, and would make this
     * file churn for no semantic change.
     */
    icons: z.record(z.string().min(1)),
    /**
     * Items both stages failed to resolve. Recorded rather than omitted: the
     * coverage test needs to tell "the wiki has no such file" apart from
     * "ingest has not been run since this item appeared", and only one of
     * those is a bug.
     */
    unresolved: z.array(z.string()),
  })
  .strict()

export type ItemIcons = z.infer<typeof ItemIconsSchema>

/** MediaWiki title casing: first character upper. Spaces are left as spaces. */
function fileTitleFor(itemName: string): string {
  const cased = itemName.length === 0 ? itemName : itemName[0]!.toUpperCase() + itemName.slice(1)
  return `File:${cased}.png`
}

/** `https://…/images/Acorn_5.png?262f7` -> `Acorn 5.png`. */
export function fileNameFromUrl(url: string): string | undefined {
  const path = url.split('?')[0]?.split('/images/')[1]
  if (path === undefined || path === '') return undefined
  return decodeURIComponent(path).replace(/_/g, ' ')
}

/**
 * Every distinct item name in the committed corpus — boss documents AND
 * `data/tables/` records.
 *
 * Shared tables are included deliberately, unlike `collectItemInputs`, which
 * excludes them on purpose. The reasoning there is about blame: a bad shared
 * record should not fail seventeen bosses. Here there is no blame to
 * misattribute — the frontend renders rare-drop-table items in exactly the
 * same grid as a boss's own, so an unresolved icon there is just as visible.
 */
export async function collectCorpusItemNames(
  bossesDir = join(REPO_ROOT, 'data', 'bosses'),
  tablesDir = join(REPO_ROOT, 'data', 'tables')
): Promise<string[]> {
  const names = new Set<string>()

  const visit = (node: Node): void => {
    if (node.kind === 'oneOf') {
      for (const entry of node.entries) visit(entry.node)
      return
    }
    // `itemId === null` is an unresolved item, but its NAME is still what the
    // grid renders and still needs an icon, so it is collected like any other.
    if (node.kind === 'item') names.add(node.name)
  }

  for (const file of (await readdir(bossesDir)).filter((f) => f.endsWith('.json'))) {
    const boss = BossSchema.parse(JSON.parse(await readFile(join(bossesDir, file), 'utf8')))
    for (const table of boss.tables) for (const entry of table.entries) visit(entry.node)
  }
  for (const file of (await readdir(tablesDir)).filter((f) => f.endsWith('.json'))) {
    const table = SharedTableSchema.parse(JSON.parse(await readFile(join(tablesDir, file), 'utf8')))
    for (const entry of table.entries) visit(entry.node)
  }

  return [...names].sort()
}

/** Snapshot key for a stage-1 batch. Content-addressed by its own contents, not by index. */
function batchKey(names: readonly string[]): string {
  return `batch-${slugify(names[0] ?? 'empty')}`
}

async function cachedRequest(
  client: WikiClient,
  key: string,
  params: Record<string, string>
): Promise<unknown> {
  try {
    return (await readSnapshot('item-icon', key)).body
  } catch {
    // No snapshot yet — this is the only path that touches the network.
  }
  const record = await client.request(params)
  await writeSnapshot('item-icon', key, record)
  return record.body
}

export interface ResolveIconsResult extends ItemIcons {
  /** How many names each stage resolved, for the run log. */
  stats: { total: number; viaImageInfo: number; viaSearch: number; unresolved: number }
}

export async function resolveItemIcons(
  client: WikiClient,
  names: readonly string[]
): Promise<ResolveIconsResult> {
  const icons: Record<string, string> = {}
  const missing: string[] = []

  // Stage 1 — batched imageinfo, which follows file redirects.
  for (let i = 0; i < names.length; i += TITLES_PER_REQUEST) {
    const batch = names.slice(i, i + TITLES_PER_REQUEST)
    const body = await cachedRequest(client, batchKey(batch), {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      titles: batch.map(fileTitleFor).join('|'),
    })
    const parsed = ImageInfoResponseSchema.parse(body)
    const normalized = new Map(
      (parsed.query.normalized ?? []).map((entry) => [entry.from, entry.to] as const)
    )
    const byTitle = new Map(parsed.query.pages.map((page) => [page.title, page] as const))

    for (const name of batch) {
      const requested = fileTitleFor(name)
      const page = byTitle.get(normalized.get(requested) ?? requested)
      const url = page?.imageinfo?.[0]?.url
      const file = url === undefined ? undefined : fileNameFromUrl(url)
      if (file === undefined) missing.push(name)
      else icons[name] = file
    }
  }

  // Stage 2 — case-insensitive search, exact matches only.
  const viaImageInfo = Object.keys(icons).length
  const unresolved: string[] = []
  for (const name of missing) {
    const body = await cachedRequest(client, `search-${slugify(name)}`, {
      action: 'query',
      list: 'search',
      srsearch: `intitle:"${name}"`,
      srnamespace: '6',
      srlimit: '10',
    })
    const wanted = fileTitleFor(name).toLowerCase()
    const hit = FileSearchResponseSchema.parse(body).query.search.find(
      (result) => result.title.toLowerCase() === wanted
    )
    if (hit === undefined) unresolved.push(name)
    else icons[name] = hit.title.slice('File:'.length)
  }

  return {
    itemIconsVersion: ITEM_ICONS_VERSION,
    generatedAt: new Date().toISOString(),
    icons,
    unresolved: unresolved.sort(),
    stats: {
      total: names.length,
      viaImageInfo,
      viaSearch: Object.keys(icons).length - viaImageInfo,
      unresolved: unresolved.length,
    },
  }
}

export async function writeItemIcons(icons: ItemIcons, path = ITEM_ICONS_PATH): Promise<void> {
  // Fields picked explicitly, then validated — `ResolveIconsResult` carries a
  // `stats` field for the run log that has no business in the committed file,
  // and the schema is `.strict()`, so parsing the input directly rejects it.
  const sorted = Object.fromEntries(
    // Keys sorted, so a re-run with the same answers produces the same bytes and
    // a diff shows what changed rather than how the Set happened to iterate.
    Object.entries(icons.icons).sort(([a], [b]) => a.localeCompare(b))
  )
  const body = ItemIconsSchema.parse({
    itemIconsVersion: ITEM_ICONS_VERSION,
    generatedAt: icons.generatedAt,
    icons: sorted,
    unresolved: [...icons.unresolved].sort(),
  })
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

export async function readItemIcons(path = ITEM_ICONS_PATH): Promise<ItemIcons> {
  return ItemIconsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

/** Whether a stage-1 batch has already been snapshotted — used only by the run log. */
export async function snapshotExists(key: string): Promise<boolean> {
  try {
    await readFile(snapshotPath('item-icon', key), 'utf8')
    return true
  } catch {
    return false
  }
}
