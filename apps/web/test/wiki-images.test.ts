import { describe, expect, it } from 'vitest'
import { bossImageUrl, itemIconFallbackUrl, itemIconUrl, wikiFileUrl, wikiThumbUrl } from '../src/lib/wiki-images'

describe('itemIconUrl', () => {
  it('title-cases the first character and underscores spaces', () => {
    expect(itemIconUrl('Abyssal whip')).toBe('https://oldschool.runescape.wiki/images/Abyssal_whip.png')
    expect(itemIconUrl('3rd age amulet')).toBe('https://oldschool.runescape.wiki/images/3rd_age_amulet.png')
  })

  it('leaves apostrophes and brackets as the wiki itself serves them', () => {
    // These are everywhere in the corpus — Ahrim's, Vet'ion, Antifire
    // potion(2), Diamond bolts (e) — and `encodeURIComponent` leaves both
    // characters alone. That is correct rather than a gap: the audit
    // HEAD-requested these exact URLs and they return 200. The characters
    // `encodeURIComponent` DOES escape (`#`, `?`, `&`) are the ones that would
    // otherwise break the path, which is why it is still applied.
    expect(itemIconUrl("Ahrim's hood")).toBe("https://oldschool.runescape.wiki/images/Ahrim's_hood.png")
    expect(itemIconUrl('Antifire potion(2)')).toBe(
      'https://oldschool.runescape.wiki/images/Antifire_potion(2).png'
    )
  })
})

/**
 * These are the two classes the audit found, kept as tests because the reason
 * the fallback exists is not obvious from reading the code.
 */
describe('the Special:FilePath fallback', () => {
  it('is a different host path, not a different file name', () => {
    // The point is MediaWiki resolving the file REDIRECT. `File:Acorn.png` is a
    // redirect to `File:Acorn 5.png`, so /images/Acorn.png is a hard 404 while
    // Special:FilePath/Acorn.png serves the image. Nothing here can guess the
    // "_5" suffix — that is exactly why the round trip through the wiki is
    // needed rather than a cleverer derivation.
    expect(itemIconFallbackUrl('Acorn')).toBe(
      'https://oldschool.runescape.wiki/w/Special:FilePath/Acorn.png'
    )
    expect(itemIconFallbackUrl('Coins')).toBe(
      'https://oldschool.runescape.wiki/w/Special:FilePath/Coins.png'
    )
  })

  it('does not attempt to fix the case-mismatch class, which is not derivable', () => {
    // `Baby mole` is filed as `Baby Mole.png` and `Wine of zamorak` as
    // `Wine of Zamorak.png`. Which words a proper noun capitalises is not a
    // function of the item name, so both stages miss and the placeholder
    // renders. 17 of 693 items across the corpus land here.
    expect(itemIconFallbackUrl('Baby mole')).toContain('Baby_mole.png')
    expect(itemIconFallbackUrl('Baby mole')).not.toContain('Baby_Mole.png')
  })
})

describe('boss images', () => {
  it('builds a thumbnail rather than serving full-size character art', () => {
    expect(wikiThumbUrl('Vorkath.png', 300)).toBe(
      'https://oldschool.runescape.wiki/images/thumb/Vorkath.png/300px-Vorkath.png'
    )
  })

  it('encodes names with spaces and parentheses', () => {
    // Real values from data/index.json: several sources carry a qualified
    // infobox image rather than a bare page title.
    expect(bossImageUrl('Abyssal Sire (phase 1).png', 300)).toBe(
      'https://oldschool.runescape.wiki/images/thumb/Abyssal_Sire_(phase_1).png/300px-Abyssal_Sire_(phase_1).png'
    )
  })

  it('is undefined when the index carries no image, so the caller renders a placeholder', () => {
    expect(bossImageUrl(undefined)).toBeUndefined()
  })

  it('never re-hosts: every URL points at the wiki', () => {
    for (const url of [wikiFileUrl('X.png'), wikiThumbUrl('X.png', 10), itemIconUrl('X'), itemIconFallbackUrl('X')]) {
      expect(url.startsWith('https://oldschool.runescape.wiki/')).toBe(true)
    }
  })
})
