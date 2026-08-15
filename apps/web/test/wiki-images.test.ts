import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bossImageUrl, itemIconUrl, wikiFileUrl, wikiThumbUrl } from '../src/lib/wiki-images'

/**
 * These used to assert a name -> URL derivation and a `Special:FilePath`
 * fallback. Both are gone: the derivation missed 13.6% of the corpus in one
 * structural class (stack-size suffixes the item name never mentions), and
 * ingest now resolves every file name against the wiki's own API. What is left
 * to test here is URL construction from a KNOWN file name, which is the only
 * job this module still has.
 */
describe('itemIconUrl', () => {
  it('builds a CDN URL from a resolved file name', () => {
    expect(itemIconUrl('Draconic visage.png')).toBe(
      'https://oldschool.runescape.wiki/images/Draconic_visage.png'
    )
    // The stack-suffix class, which no name derivation could produce.
    expect(itemIconUrl('Acorn 5.png')).toBe('https://oldschool.runescape.wiki/images/Acorn_5.png')
    expect(itemIconUrl('Coins 100.png')).toBe('https://oldschool.runescape.wiki/images/Coins_100.png')
  })

  it('leaves apostrophes and brackets as the wiki itself serves them', () => {
    // `encodeURIComponent` leaves both alone, which is correct — these exact
    // URLs return 200. What it does escape (`#`, `?`, `&`) is what would
    // otherwise break the path.
    expect(itemIconUrl("Ahrim's hood.png")).toBe(
      "https://oldschool.runescape.wiki/images/Ahrim's_hood.png"
    )
    expect(itemIconUrl('Adamant bolts(unf) 5.png')).toBe(
      'https://oldschool.runescape.wiki/images/Adamant_bolts(unf)_5.png'
    )
  })

  it('returns undefined for an unresolved item, so the caller draws a placeholder', () => {
    // Deliberately NOT a name-derived guess. A guess is what the measurement
    // rejected, and substituting one here would put the 13.6% back with the
    // miss rate no longer visible anywhere.
    expect(itemIconUrl(undefined)).toBeUndefined()
  })
})

describe('boss images', () => {
  it('builds a thumbnail rather than serving full-size character art', () => {
    expect(wikiThumbUrl('Vorkath.png', 300)).toBe(
      'https://oldschool.runescape.wiki/images/thumb/Vorkath.png/300px-Vorkath.png'
    )
  })

  it('encodes names with spaces and parentheses', () => {
    expect(bossImageUrl('Abyssal Sire (phase 1).png', 300)).toBe(
      'https://oldschool.runescape.wiki/images/thumb/Abyssal_Sire_(phase_1).png/300px-Abyssal_Sire_(phase_1).png'
    )
  })

  it('is undefined when the index carries no image, so the caller renders a placeholder', () => {
    expect(bossImageUrl(undefined)).toBeUndefined()
  })

  it('never re-hosts: every URL points at the wiki', () => {
    for (const url of [wikiFileUrl('X.png'), wikiThumbUrl('X.png', 10), itemIconUrl('X.png')]) {
      expect(url?.startsWith('https://oldschool.runescape.wiki/')).toBe(true)
    }
  })
})

/**
 * The committed map and this module have to agree about what a "file name"
 * is. Nothing else checks the seam between them — ingest validates the file it
 * writes, and the URL builder validates a string it is handed.
 */
describe('the committed data/item-icons.json feeds this module cleanly', () => {
  const icons = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'data', 'item-icons.json'), 'utf8')
  ) as { icons: Record<string, string> }

  it('produces a well-formed wiki URL for every entry', () => {
    const entries = Object.entries(icons.icons)
    expect(entries.length).toBeGreaterThan(600)
    for (const [name, file] of entries) {
      const url = itemIconUrl(file)
      expect(url, name).toMatch(/^https:\/\/oldschool\.runescape\.wiki\/images\/\S+\.(png|gif|jpg)$/i)
      expect(url, name).not.toContain(' ')
    }
  })
})
