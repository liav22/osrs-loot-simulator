import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractInfoboxImage } from '../src/parse/infobox-image.js'
import { BOSSES_DIR } from '../src/parse/parse-boss.js'
import { SITE_INDEX_PATH, SiteIndexSchema } from '../src/site-index.js'

describe('extractInfoboxImage', () => {
  it('reads the file name out of an infobox image parameter', () => {
    expect(extractInfoboxImage('{{Infobox Monster\n|name = Vorkath\n|image = [[File:Vorkath.png|300px]]\n}}')).toBe(
      'Vorkath.png'
    )
  })

  it('takes the first image on a Multi Infobox page', () => {
    // Abyssal Sire's four phases, Vorkath's two quest states: the wiki shows
    // the first by default, so the first is the recognisable one.
    const wikitext = [
      '{{Multi Infobox',
      '|item1 =',
      '{{Infobox Monster',
      '|image1 = [[File:Abyssal Sire (phase 1).png|300px]]',
      '|image2 = [[File:Abyssal Sire (phase 2).png|300px]]',
      '}}',
    ].join('\n')
    expect(extractInfoboxImage(wikitext)).toBe('Abyssal Sire (phase 1).png')
  })

  it('accepts the Image: alias and tolerates spacing', () => {
    expect(extractInfoboxImage('|  image   =  [[ Image:Zulrah (serpentine).png |frameless]]')).toBe(
      'Zulrah (serpentine).png'
    )
  })

  it('skips an image parameter with no file link, and returns undefined when there is none', () => {
    expect(extractInfoboxImage('|image = \n|image2 = [[File:Kraken.png]]')).toBe('Kraken.png')
    expect(extractInfoboxImage('{{Infobox Monster\n|name = Nothing\n}}')).toBeUndefined()
    // A File link outside an `|image =` parameter is not the infobox image.
    expect(extractInfoboxImage('See [[File:Some map.png]] for the route.')).toBeUndefined()
  })
})

/**
 * The committed index is what the frontend actually renders from, and the field
 * is optional — so a regeneration that silently dropped every image would break
 * no schema and fail no other test. This is the check that would catch it.
 */
describe('the real committed site index', () => {
  it('carries an infobox image for every boss document', async () => {
    const index = SiteIndexSchema.parse(JSON.parse(await readFile(SITE_INDEX_PATH, 'utf8')))
    const slugs = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))

    expect(slugs.length).toBeGreaterThan(0)
    const withoutImage = index.entries.filter((e) => e.image === undefined).map((e) => e.slug)
    expect(withoutImage).toEqual([])
    expect(index.entries.map((e) => e.slug).sort()).toEqual(slugs.sort())
  })

  it('records file names rather than URLs, so the frontend chooses the size', async () => {
    const index = SiteIndexSchema.parse(JSON.parse(await readFile(SITE_INDEX_PATH, 'utf8')))
    for (const entry of index.entries) {
      expect(entry.image).toMatch(/\.(png|jpg|gif)$/i)
      expect(entry.image).not.toMatch(/^https?:|\//)
    }
  })

  it('names a real boss file for every entry', async () => {
    const index = SiteIndexSchema.parse(JSON.parse(await readFile(SITE_INDEX_PATH, 'utf8')))
    for (const entry of index.entries) {
      await expect(readFile(join(BOSSES_DIR, `${entry.slug}.json`), 'utf8')).resolves.toBeTypeOf('string')
    }
  })
})
