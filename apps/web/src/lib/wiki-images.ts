/**
 * Wiki image URLs. Nothing is re-hosted — PROJECT_PLAN.md 10's licence
 * position is that linking to CC BY-NC-SA assets carries obligations that
 * copying them does not, so `data/` holds no image files.
 *
 * ## The item-icon miss rate, measured
 *
 * The plan for icons was "the URL follows a predictable pattern from the item
 * name." It does not, and the gap was measured rather than guessed: every one
 * of the 693 distinct items in the 54 parsed sources was HEAD-requested at its
 * derived URL.
 *
 *   - `/images/{Name}.png` — **94 of 693 return 404 (13.6%)**
 *   - retrying those 94 through `Special:FilePath` — **17 still fail (2.5%)**
 *
 * The 13.6% is not scattered noise, which is why it cannot be waved off as an
 * acceptable placeholder rate. It is one structural class: every stackable
 * item's icon file carries a stack-size suffix the item name does not mention
 * — `Acorn` is `Acorn_5.png`, `Coins` is `Coins_100.png`, `Ancient essence` is
 * `Ancient_essence_500.png`, `Brimstone key` is `Brimstone_key_1.png`. The
 * suffix varies (1, 5, 100, 500, and `Cow slippers` uses `(1)`), so no rule
 * over the item name produces it. It catches every seed, every arrow and bolt
 * type, Coins, Zulrah's scales, Sunfire splinters and Crystal shard — the
 * highest-count items in any results grid, so the share of *visible* cards
 * affected is worse than 13.6%.
 *
 * `Special:FilePath` fixes that whole class, because MediaWiki resolves file
 * redirects there and `File:Acorn.png` is a redirect to `File:Acorn 5.png`.
 * It is used as an error fallback and never as the primary source: it is a
 * special page rather than a CDN path, and the audit was rate-limited (HTTP
 * 429) requesting 94 of them at five-way concurrency. As a sparse fallback for
 * the ~14% that 404 it stays well inside that limit; as the `src` for every
 * icon in a 24-card grid it would not.
 *
 * The residual 17 (2.5%) are all case-only mismatches on proper nouns —
 * `Baby mole` is filed as `Baby Mole.png`, `Wine of zamorak` as
 * `Wine of Zamorak.png`, `Vet'ion jr.` as `Vet'ion Jr..png`, and 14 of the 17
 * are pets. Which words to capitalise is not derivable from the item name, so
 * these fall through to the placeholder. **The real fix is for ingest to
 * resolve icon URLs via the wiki's `imageinfo` API and store them** — 693
 * items is 14 batched requests, and it would take the miss rate to zero for
 * all three classes at once. That is a pipeline change and deliberately out of
 * scope here.
 */

const WIKI = 'https://oldschool.runescape.wiki'

/** MediaWiki title casing: first character upper, spaces to underscores. */
function titleToPath(title: string): string {
  const cased = title.length === 0 ? title : title[0]!.toUpperCase() + title.slice(1)
  return encodeURIComponent(cased.replace(/ /g, '_'))
}

/** Direct CDN path for a file. 404s if the title is a redirect rather than the file itself. */
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

/** First attempt for an item icon: the CDN path, cache-friendly and correct 86% of the time. */
export function itemIconUrl(name: string): string {
  return wikiFileUrl(`${name}.png`)
}

/**
 * Second attempt, on error only: MediaWiki follows file redirects here, which
 * is what resolves every stack-size-suffixed icon. See this file's header for
 * why it must not be the first attempt.
 */
export function itemIconFallbackUrl(name: string): string {
  return `${WIKI}/w/Special:FilePath/${titleToPath(`${name}.png`)}`
}
