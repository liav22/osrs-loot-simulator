/**
 * Wiki image URLs. Nothing is re-hosted — PROJECT_PLAN.md 10's licence
 * position is that linking to CC BY-NC-SA assets carries obligations that
 * copying them does not, so `data/` holds no image files.
 *
 * ## Icon file names are resolved by ingest, not derived here
 *
 * This module used to build item icon URLs from the item name and fall back to
 * `Special:FilePath` when that 404'd. An audit over all 693 distinct items in
 * the parsed corpus measured the derivation at a **13.6% miss rate**, and not
 * as scattered noise — one structural class, where every stackable item's icon
 * file carries a stack-size suffix the item name never mentions (`Acorn` is
 * `Acorn 5.png`, `Coins` is `Coins 100.png`). No rule over the name produces
 * the suffix, and the class covers every seed, arrow, bolt and shard, which
 * are the highest-count items in any results grid.
 *
 * `data/item-icons.json` now carries the resolved file name for every item,
 * produced by `ingest item-icons` (see `apps/ingest/src/items/icons.ts` for how
 * the two resolution stages work). The browser makes one request per icon, to
 * the CDN, and it is the right one. **The `Special:FilePath` fallback is gone**
 * — it was a second request per miss against a MediaWiki special page that
 * rate-limits, and there is nothing left for it to catch.
 */

const WIKI = 'https://oldschool.runescape.wiki'

/** MediaWiki title casing: first character upper, spaces to underscores. */
function titleToPath(title: string): string {
  const cased = title.length === 0 ? title : title[0]!.toUpperCase() + title.slice(1)
  return encodeURIComponent(cased.replace(/ /g, '_'))
}

/** Direct CDN path for a file whose exact name is already known. */
export function wikiFileUrl(file: string): string {
  return `${WIKI}/images/${titleToPath(file)}`
}

/**
 * A scaled copy from the wiki's thumbnailer. Boss infobox art is full-size
 * character art — hundreds of KB for a box a couple of hundred pixels wide.
 */
export function wikiThumbUrl(file: string, width: number): string {
  const path = titleToPath(file)
  return `${WIKI}/images/thumb/${path}/${width}px-${path}`
}

/** The boss portrait `data/index.json` records, at a width the layout picks. */
export function bossImageUrl(image: string | undefined, width = 300): string | undefined {
  return image === undefined ? undefined : wikiThumbUrl(image, width)
}

/**
 * An item's icon, from the resolved file name.
 *
 * `undefined` in means `undefined` out, and the caller renders a placeholder.
 * There is deliberately no name-derived guess behind this: a guess is what the
 * measurement rejected, and silently substituting one would put the 13.6% back
 * without the miss rate being visible anywhere.
 */
export function itemIconUrl(file: string | undefined): string | undefined {
  return file === undefined ? undefined : wikiFileUrl(file)
}
