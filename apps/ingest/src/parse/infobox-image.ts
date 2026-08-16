/**
 * The one piece of pipeline work the UI rework needs: a boss's infobox image.
 *
 * Item icons are derivable from the item name (badly — see
 * `apps/web/src/lib/wiki-images.ts` for the measured miss rate). A boss's
 * portrait is not: `Kraken` illustrates its own page with `Whirlpool.png` and
 * Zulrah with `Zulrah (serpentine).png`, neither of which any rule over the
 * page title produces. So it has to be read off the page and carried in
 * `data/index.json`.
 *
 * Read from `data/snapshots/wikitext/`, never the live wiki — CLAUDE.md's hard
 * rule. The snapshot directory is gitignored and machine-local, which is why
 * `buildSiteIndex` merges rather than overwrites: a regeneration on a machine
 * with no snapshots must not silently strip the field out of the committed
 * index.
 */

/**
 * The FILE NAME, not a URL. Sizing is a presentation decision — the frontend
 * builds a thumbnail URL at whatever width its layout wants, and changing that
 * width must not require re-running ingest.
 */
export type InfoboxImage = string

const IMAGE_PARAM = /^\s*\|\s*image\d*\s*=\s*(.*)$/gm
const BUCKET_IMAGE_PARAM = /^\s*\|\s*bucketimage\s*=\s*(.*)$/im
const FILE_LINK = /\[\[\s*(?:File|Image):([^|\]]+)/i

function fileFrom(value: string | undefined): InfoboxImage | undefined {
  const link = FILE_LINK.exec(value ?? '')
  const file = link?.[1]?.trim()
  return file === undefined || file === '' ? undefined : file
}

/**
 * The page's infobox image: `|bucketimage =` when the page offers one, else the
 * first `|image =` parameter carrying a `[[File:…]]` link, in page order.
 *
 * **`bucketimage` wins, and Mad Angel is why.** Its `|image =` is
 * `Mad Angel.webp`, a 5.4 MB **animated** webp; the wiki's thumbnailer cannot
 * usefully scale it, so a "300px" thumbnail still weighs **2.6 MB** — against
 * 36 KB for a comparable png portrait. The same page supplies
 * `|bucketimage = [[File:Mad Angel.png]]`, whose 300px thumb is 88 KB. All
 * three figures were measured against the live CDN, not assumed.
 *
 * `bucketimage` is the wiki's own designation of the image to use in a data
 * context rather than on the page, which is exactly this. Blast radius was
 * checked before preferring it: across all 209 wikitext snapshots, **one page
 * carries `bucketimage` and one page has a `.webp` image, and they are the same
 * page** — so this changes exactly the entry that is broken and nothing else.
 *
 * "First" is deliberate on `{{Multi Infobox}}` pages, where several versions of
 * a monster each bring their own image (Vorkath's Post-quest/Dragon Slayer II,
 * Abyssal Sire's four phases). The first one is the version the wiki itself
 * shows by default, which is the one a person recognises.
 */
export function extractInfoboxImage(wikitext: string): InfoboxImage | undefined {
  const bucket = fileFrom(BUCKET_IMAGE_PARAM.exec(wikitext)?.[1])
  if (bucket !== undefined) return bucket

  IMAGE_PARAM.lastIndex = 0
  for (const match of wikitext.matchAll(IMAGE_PARAM)) {
    const file = fileFrom(match[1])
    if (file !== undefined) return file
  }
  return undefined
}
