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
const FILE_LINK = /\[\[\s*(?:File|Image):([^|\]]+)/i

/**
 * First `|image =` parameter carrying a `[[File:…]]` link, in page order.
 *
 * "First" is deliberate on `{{Multi Infobox}}` pages, where several versions of
 * a monster each bring their own image (Vorkath's Post-quest/Dragon Slayer II,
 * Abyssal Sire's four phases). The first one is the version the wiki itself
 * shows by default, which is the one a person recognises.
 */
export function extractInfoboxImage(wikitext: string): InfoboxImage | undefined {
  IMAGE_PARAM.lastIndex = 0
  for (const match of wikitext.matchAll(IMAGE_PARAM)) {
    const link = FILE_LINK.exec(match[1] ?? '')
    if (link === null) continue
    const file = link[1]?.trim()
    if (file !== undefined && file !== '') return file
  }
  return undefined
}
