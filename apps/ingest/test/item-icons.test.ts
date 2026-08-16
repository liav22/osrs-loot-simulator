import { describe, expect, it } from 'vitest'
import {
  collectCorpusItemNames,
  stackSuffixPattern,
  fileNameFromUrl,
  readItemIcons,
  writeItemIcons,
  ItemIconsSchema,
} from '../src/items/icons.js'

describe('fileNameFromUrl', () => {
  it('strips the cache-buster and un-encodes the path to a title', () => {
    // The cache-buster changes on every re-upload; keeping it would make the
    // committed file churn with no semantic change.
    expect(fileNameFromUrl('https://oldschool.runescape.wiki/images/Acorn_5.png?262f7')).toBe(
      'Acorn 5.png'
    )
    expect(fileNameFromUrl('https://oldschool.runescape.wiki/images/Ahrim%27s_hood.png?8d9e1')).toBe(
      "Ahrim's hood.png"
    )
    expect(
      fileNameFromUrl('https://oldschool.runescape.wiki/images/Adamant_bolts%28unf%29_5.png?189c1')
    ).toBe('Adamant bolts(unf) 5.png')
  })

  it('returns undefined for a URL with no /images/ path', () => {
    expect(fileNameFromUrl('https://oldschool.runescape.wiki/w/Acorn')).toBeUndefined()
  })
})

/**
 * The committed map is what the frontend renders from, and an item missing
 * from it degrades silently to a placeholder — exactly the failure this whole
 * change exists to remove. These are the checks that would catch it coming
 * back.
 */
describe('the committed data/item-icons.json', () => {
  it('covers every item name in the corpus, resolved or explicitly unresolved', async () => {
    const names = await collectCorpusItemNames()
    const icons = await readItemIcons()

    expect(names.length).toBeGreaterThan(600)
    const known = new Set([...Object.keys(icons.icons), ...icons.unresolved])
    const uncovered = names.filter((name) => !known.has(name))
    expect(uncovered).toEqual([])
  })

  it('resolves all but the three the wiki genuinely has no plain icon for', async () => {
    const icons = await readItemIcons()
    // Pinned rather than counted loosely, because "unresolved" is where a
    // regression would hide: a resolution bug would quietly grow this list and
    // a >= assertion would never notice.
    //
    // `Muphin` exists on the wiki only as (shielded)/(melee)/(ranged) variants
    // with no plain file. `Nothing` is not an item at all — it is a drop row
    // literally named that, with itemId null, on Black Knight Titan and
    // Salarin the Twisted.
    //
    // `Ikkle Hydra` joined them with Alchemical Hydra (tier D). Same shape as
    // Muphin: the pet exists only as colour variants, and its drop row says so
    // itself — `{{DropsLine|name=Ikkle Hydra|image=Ikkle Hydra (serpentine).png}}`.
    // Stage 2 refuses parenthetical qualifiers on purpose (the `Baby Mole (NPC)`
    // rule), so this is the resolver working, not failing. **The row carries an
    // explicit `image=` the parser does not currently read — using it would
    // resolve this class outright, and is the obvious next improvement here.**
    //
    // `Belladonna seed` was a fourth case and is now resolved: its icon is
    // `File:Belladonna seed 5.png`, a stack-size suffix the item name never
    // mentions. Stage 1 resolves that whole class through MediaWiki's file
    // redirects and this item has none, so stage 2 now accepts a strictly
    // numeric suffix as well — see `stackSuffixPattern`.
    expect(icons.unresolved).toEqual(['Ikkle Hydra', 'Muphin', 'Nothing'])
  })

  it('stores file names rather than URLs, so the frontend owns the encoding', async () => {
    const icons = await readItemIcons()
    for (const [name, file] of Object.entries(icons.icons)) {
      expect(file, name).toMatch(/\.(png|gif|jpg)$/i)
      expect(file, name).not.toMatch(/^https?:|\?|\/images\//)
      // Underscores would mean a raw URL path leaked through instead of a title.
      expect(file, name).not.toContain('_')
    }
  })

  it('resolves the stack-suffix class the name-derivation could not', async () => {
    // The 13.6% miss rate was one structural class, and this is it: the icon
    // file carries a stack size the item name never mentions, and the suffix
    // varies per item so no rule produces it.
    const { icons } = await readItemIcons()
    expect(icons['Acorn']).toBe('Acorn 5.png')
    expect(icons['Coins']).toBe('Coins 100.png')
    expect(icons['Ancient essence']).toBe('Ancient essence 500.png')
    expect(icons['Brimstone key']).toBe('Brimstone key 1.png')
    expect(icons['Cow slippers']).toBe('Cow slippers (1).png')
  })

  it('resolves the case-mismatch class via exact-title search', async () => {
    // Which words a proper noun capitalises is not a function of the item
    // name, so these can only come from asking the wiki.
    const { icons } = await readItemIcons()
    expect(icons['Baby mole']).toBe('Baby Mole.png')
    expect(icons['Wine of zamorak']).toBe('Wine of Zamorak.png')
    expect(icons["Vet'ion jr."]).toBe("Vet'ion Jr..png")
    expect(icons['Pet snakeling']).toBe('Pet Snakeling.png')
  })
})

describe('writeItemIcons', () => {
  it('rejects a payload that does not match the schema', () => {
    expect(() =>
      ItemIconsSchema.parse({ itemIconsVersion: 1, generatedAt: 'x', icons: {} })
    ).toThrow()
    expect(() =>
      ItemIconsSchema.parse({
        itemIconsVersion: 1,
        generatedAt: 'x',
        icons: {},
        unresolved: [],
        extra: true,
      })
    ).toThrow()
  })

  it('accepts the shape the resolver produces, extra run-log fields and all', async () => {
    // `ResolveIconsResult` carries `stats`; `writeItemIcons` picks fields
    // explicitly so the strict schema does not reject its own input.
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'item-icons-'))
    const path = join(dir, 'out.json')

    await writeItemIcons(
      {
        itemIconsVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        icons: { Zeta: 'Zeta.png', Alpha: 'Alpha.png' },
        unresolved: ['Zed', 'Ada'],
        stats: { total: 2, viaImageInfo: 2, viaSearch: 0, unresolved: 2 },
      } as never,
      path
    )

    const written = JSON.parse(await readFile(path, 'utf8'))
    expect(written).not.toHaveProperty('stats')
    // Sorted, so a re-run with the same answers is a byte-identical file.
    expect(Object.keys(written.icons)).toEqual(['Alpha', 'Zeta'])
    expect(written.unresolved).toEqual(['Ada', 'Zed'])
  })
})

/**
 * The stack-suffix rule that resolves `Belladonna seed`.
 *
 * Stage 2's whole safety is that it accepts only an exact title match, so
 * widening it at all needs the boundary pinned: these are the real search hits
 * that must still be refused.
 */
describe('stackSuffixPattern', () => {
  it('accepts a strictly numeric stack suffix', () => {
    expect(stackSuffixPattern('Belladonna seed').test('File:Belladonna seed 5.png')).toBe(true)
    expect(stackSuffixPattern('Acorn').test('File:Acorn 5.png')).toBe(true)
    expect(stackSuffixPattern('Ancient essence').test('File:Ancient essence 500.png')).toBe(true)
    // MediaWiki upper-cases the first letter of a title.
    expect(stackSuffixPattern('coins').test('File:Coins 100.png')).toBe(true)
  })

  it('still refuses every qualifier that is not a bare number', () => {
    // The exact hits that made the exact-match rule necessary. Accepting any
    // of these ships the wrong picture for a real item.
    expect(stackSuffixPattern('Baby mole').test('File:Baby Mole (NPC).png')).toBe(false)
    expect(stackSuffixPattern('Baby mole').test('File:Baby Mole detail.png')).toBe(false)
    expect(stackSuffixPattern('Muphin').test('File:Muphin (shielded).png')).toBe(false)
    expect(stackSuffixPattern('Cow slippers').test('File:Cow slippers (1).png')).toBe(false)
    expect(stackSuffixPattern('Acorn').test('File:Acorn seed 5.png')).toBe(false)
  })

  it('does not let a name with regex metacharacters match something else', () => {
    // `Vet'ion jr.` — the `.` is a literal, not "any character".
    expect(stackSuffixPattern("Vet'ion jr.").test("File:Vet'ion jr. 5.png")).toBe(true)
    expect(stackSuffixPattern("Vet'ion jr.").test("File:Vet'ion jrX 5.png")).toBe(false)
  })
})
