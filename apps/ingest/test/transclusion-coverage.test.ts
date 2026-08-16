import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { readSnapshot, slugify, snapshotPath } from '../src/snapshots/store.js'
import { BucketResponseSchema } from '../src/wiki/schemas.js'
import {
  expandTransclusions,
  loadTemplateDefinitions,
  type TemplateDefinitions,
} from '../src/parse/expand-transclusions.js'
import { extractDropLines } from '../src/parse/wikitext-drops.js'

/**
 * The expansion checked against the wiki's OWN published figures.
 *
 * `expand-transclusions.test.ts` proves the machinery works on synthetic
 * fixtures. This proves it produces the right numbers on the real corpus, and
 * it is the step that stops a plausible-looking-but-wrong expansion from
 * shipping — the same discipline `docs/OVERRIDES.md` step 3 requires of a
 * hand-authored mechanic.
 *
 * The oracle is the `dropsline` bucket snapshot: a different view of the same
 * page, produced by the wiki itself from the RENDERED drop tables, so it sees
 * through exactly the transclusions the raw wikitext hides. It is what
 * `drops_covered` uses for coverage; here the rarities are compared too, which
 * coverage alone would not catch — a recovered row with a wrong rate passes
 * `drops_covered` and is worse than a missing one.
 *
 * Everything read here is under `data/snapshots/`, which is gitignored, so the
 * whole suite skips when it is absent — see `SNAPSHOTS_PRESENT` below.
 */

/** Sources whose seed/herb/talisman sub-tables are transcluded. */
const SEED_HERB_TALISMAN_SOURCES = [
  'Vorkath',
  'Abyssal Sire',
  'Araxxor',
  'Dagannoth Rex',
  'Dagannoth Prime',
  'Dagannoth Supreme',
  'Sarachnis',
  'Phantom Muspah',
  'Deranged archaeologist',
  'Giant sea snake',
  'Arrg',
  'Salarin the Twisted',
] as const

/**
 * Sources whose Wilderness Slayer tertiary is transcluded. Kept as its own
 * list because its template computes a per-boss key denominator from the
 * monster's combat level, so these are the sources where a rate is DERIVED
 * rather than shared — and the ones a broken `{{#expr:}}` silently gave a flat
 * 1/50 before the comparison operators existed.
 */
const WILDERNESS_SLAYER_SOURCES = [
  'Callisto',
  "Vet'ion",
  'Artio',
  'Spindel',
  'Scorpia',
  "Calvar'ion",
  'Crazy archaeologist',
  'Venenatis',
] as const

/**
 * Black demon transcludes `{{HerbDropLines}}` too and is deliberately NOT in
 * that list, even though the heading gap that used to hide it entirely
 * (`==Level 172, 178, and 184 drops==` / `==Wilderness Slayer Cave drops==`,
 * five- and three-word prefixes the tight `DROPS_SECTION_TITLE` rule couldn't
 * see) is fixed — `wikitext-drops.test.ts` pins that fix directly. The reason
 * it still can't join the shared loop is a SEPARATE, unrelated gap the heading
 * fix exposed rather than closed: see the dedicated test below.
 */

interface Row {
  name: string
  rarity: string
}

/** The wiki's own rendered rarity strings, keyed by item name (a name can carry several). */
async function bucketRarities(title: string): Promise<Map<string, Set<string>> | null> {
  try {
    const snapshot = await readSnapshot('dropsline', slugify(title))
    const rows = BucketResponseSchema.parse(snapshot.body).bucket ?? []
    const byName = new Map<string, Set<string>>()
    for (const row of rows) {
      const name = row.item_name
      const json = row.drop_json
      if (typeof name !== 'string' || typeof json !== 'string') continue
      const rarity = (JSON.parse(json) as { Rarity?: string }).Rarity
      if (rarity === undefined) continue
      if (!byName.has(name)) byName.set(name, new Set())
      byName.get(name)!.add(normalizeRarity(rarity))
    }
    return byName
  } catch {
    return null
  }
}

/** `1/1,136.4` and `~1/1136.4` are the same figure written two ways. */
function normalizeRarity(rarity: string): string {
  return rarity.replace(/,/g, '').replace(/^~/, '').trim()
}

async function pageWikitext(title: string): Promise<string | null> {
  try {
    const snapshot = await readSnapshot('wikitext', slugify(title))
    return (snapshot.body as { parse?: { wikitext?: string } }).parse?.wikitext ?? null
  } catch {
    return null
  }
}

/**
 * Checked with `existsSync` at module scope, never a read: a `describe.skipIf`
 * still INVOKES its callback to collect the tests inside it, so a module-scope
 * `readFileSync` throws during collection on every clean checkout. The reads
 * themselves live in `beforeAll`, whose hooks a skipped suite never runs.
 */
const SNAPSHOTS_PRESENT =
  existsSync(snapshotPath('wikitext', 'vorkath')) &&
  existsSync(snapshotPath('wikitext', 'template-treeherbseeddroplines'))

let definitions: TemplateDefinitions

beforeAll(async () => {
  definitions = await loadTemplateDefinitions()
})

describe.skipIf(!SNAPSHOTS_PRESENT)('transclusion expansion against the wiki’s own figures', () => {
  for (const title of SEED_HERB_TALISMAN_SOURCES) {
    it(`${title}: every row recovered by expansion carries the wiki's own rarity`, async () => {
      const wikitext = await pageWikitext(title)
      const oracle = await bucketRarities(title)
      if (wikitext === null || oracle === null) return

      const before = extractDropLines(wikitext)
      const expansion = expandTransclusions(wikitext, definitions)
      const after = extractDropLines(expansion.wikitext)

      // Expansion only ever adds rows; it must never lose one.
      expect(after.length).toBeGreaterThan(before.length)

      const known = new Set(before.map((line) => line.name))
      const recovered: Row[] = after
        .filter((line) => !known.has(line.name))
        .map((line) => ({ name: line.name, rarity: normalizeRarity(line.rarity) }))

      expect(recovered.length).toBeGreaterThan(0)

      const wrong = recovered.filter((row) => {
        const published = oracle.get(row.name)
        // A name the bucket does not list at all is a different failure and is
        // `drops_covered`'s (one-directional) business, not this test's.
        return published !== undefined && !published.has(row.rarity)
      })
      expect(wrong).toEqual([])
    })
  }

  for (const title of WILDERNESS_SLAYER_SOURCES) {
    it(`${title}: Larran's key carries its own DERIVED denominator, not a fallback`, async () => {
      const wikitext = await pageWikitext(title)
      const oracle = await bucketRarities(title)
      if (wikitext === null || oracle === null) return

      const expansion = expandTransclusions(wikitext, definitions)
      expect(expansion.unexpandable).toEqual([])

      const rows = extractDropLines(expansion.wikitext)
      for (const name of ["Larran's key", "Slayer's enchantment"]) {
        const row = rows.find((line) => line.name === name)
        expect(row, `${title} should recover ${name}`).toBeDefined()
        expect(oracle.get(name)).toContain(normalizeRarity(row?.rarity ?? ''))
      }
    })
  }

  it('the wilderness bosses do NOT all land on the same key denominator', async () => {
    const denominators = new Set<string>()
    for (const title of WILDERNESS_SLAYER_SOURCES) {
      const wikitext = await pageWikitext(title)
      if (wikitext === null) continue
      const rows = extractDropLines(expandTransclusions(wikitext, definitions).wikitext)
      const key = rows.find((line) => line.name === "Larran's key")
      if (key !== undefined) denominators.add(key.rarity)
    }
    // The failure this pins is not "a rate is wrong" but "every rate is the
    // SAME wrong value" — a `{{#switch:}}` falling through to its literal
    // default looks completely healthy row by row.
    expect(denominators.size).toBeGreaterThan(1)
  })

  it("Corporeal Beast: the sigil sub-table's ratios survive as weights", async () => {
    const wikitext = await pageWikitext('Corporeal Beast')
    if (wikitext === null) return
    const rows = extractDropLines(expandTransclusions(wikitext, definitions).wikitext)
    // The page states a 1/585 roll onto the sigil table, then 3/7 spectral,
    // 3/7 arcane, 1/7 elysian — published as the effective 1/1365, 1/1365,
    // 1/4095. Those homogenise onto one denominator of 4095 downstream, which
    // is 585 x 7, recovering the sub-table exactly.
    expect(rows.find((r) => r.name === 'Spectral sigil')?.rarity).toBe('1/1365')
    expect(rows.find((r) => r.name === 'Arcane sigil')?.rarity).toBe('1/1365')
    expect(rows.find((r) => r.name === 'Elysian sigil')?.rarity).toBe('1/4095')
  })

  /**
   * The inverse of the old pin. Black demon's herb sub-table is reachable now,
   * and — checked directly, not assumed — every recovered herb row carries the
   * wiki's own published rarity, exactly like the sources in
   * `SEED_HERB_TALISMAN_SOURCES`. It isn't IN that list because it can't make
   * that loop's blanket promise ("every row expansion recovers is correct"):
   * the SAME page also transcludes `{{WildernessSlayerDropTable}}`, whose key
   * denominator needs `{{#expr:320 - (floor({{min|{{{hitpoints}}}|300}} *
   * 0.8))}}` — a genuinely different, still-open gap from landmine #11c's
   * `#switch` fallthrough: this one is an unsupported `min()` token, reported
   * correctly (`unparseable rarity`, `transclusion not expanded`) rather than
   * silently producing a wrong number, so both `Slayer's enchantment` and
   * `Larran's key` stay missing from the assembled document (the whole
   * heading-block is excluded together, taking a resolvable sibling row down
   * with an unresolvable one — the same all-or-nothing pattern
   * Reward Cart's ambiguous headings show elsewhere). Not fixed here: adding
   * `min()` support to the `#expr` evaluator is a different, unrelated task
   * from the heading-matching gap this file is about.
   */
  it('Black demon: the heading gap is fixed; the herb rows match; the Wilderness Slayer key does not expand', async () => {
    const wikitext = await pageWikitext('Black demon')
    const oracle = await bucketRarities('Black demon')
    if (wikitext === null || oracle === null) return

    // Reachable now, where it previously yielded nothing at all.
    const before = extractDropLines(wikitext)
    expect(before.length).toBeGreaterThan(0)

    const expansion = expandTransclusions(wikitext, definitions)
    const after = extractDropLines(expansion.wikitext)
    expect(after.length).toBeGreaterThan(before.length)

    const known = new Set(before.map((line) => line.name))
    const herbNames = new Set([
      'Grimy guam leaf',
      'Grimy marrentill',
      'Grimy tarromin',
      'Grimy harralander',
      'Grimy ranarr weed',
      'Grimy irit leaf',
      'Grimy avantoe',
      'Grimy kwuarm',
      'Grimy cadantine',
      'Grimy lantadyme',
      'Grimy dwarf weed',
      'Grimy torstol',
    ])
    const recoveredHerbs = after.filter((line) => !known.has(line.name) && herbNames.has(line.name))
    // Recovered on both of the page's two drop sections (normal-level and
    // Wilderness Slayer Cave) — not a flat 24 (2x12), because the two
    // sections' herb sub-tables don't carry identical rosters.
    expect(recoveredHerbs.length).toBeGreaterThanOrEqual(20)
    const wrong = recoveredHerbs.filter((row) => {
      const published = oracle.get(row.name)
      const rarity = normalizeRarity(row.rarity)
      return published !== undefined && !published.has(rarity)
    })
    expect(wrong).toEqual([])

    // The residual: still genuinely unexpandable, reported as such rather than
    // silently wrong.
    expect(expansion.unexpandable.some((u) => u.reason.includes("unsupported token 'min'"))).toBe(true)
  })

  it('Vorkath: the honoured per-page rarity OVERRIDE, not just the template default', async () => {
    const wikitext = await pageWikitext('Vorkath')
    if (wikitext === null) return
    const lines = extractDropLines(expandTransclusions(wikitext, definitions).wikitext)

    // Vorkath passes `TorstolSeedRarity=1/{{#expr:1/(1/150+(3/150*22/250)) round 1}}`,
    // an EFFECTIVE chance folding in the main table's own torstol seed slot.
    // The template's untouched default for that row would be 1/1,136.4 (the
    // same 22/250 share Magic seed gets); the wiki publishes 1/118.7. Getting
    // this row right is proof the page's arguments reach the template, rather
    // than the expansion quietly falling back to defaults.
    const torstol = lines.find((line) => line.name === 'Torstol seed')
    expect(torstol?.rarity).toBe('1/118.7')
  })

  it('Abyssal Sire: `multiplier=2` reaches the expanded quantities', async () => {
    const wikitext = await pageWikitext('Abyssal Sire')
    if (wikitext === null) return
    const lines = extractDropLines(expandTransclusions(wikitext, definitions).wikitext)

    // The page states "When the drop table is rolled, double the regular
    // quantity of the item is always dropped" and passes `multiplier=2`.
    const ranarr = lines.find((line) => line.name === 'Ranarr seed')
    expect(ranarr?.quantity).toBe('2')
    // Watermelon seed's own quantity is `15*multiplier`, not the flat multiplier.
    const watermelon = lines.find((line) => line.name === 'Watermelon seed')
    expect(watermelon?.quantity).toBe('30')
  })

  it('leaves the shared rare/gem drop tables to rdt-access.ts on every real page', async () => {
    for (const title of SEED_HERB_TALISMAN_SOURCES) {
      const wikitext = await pageWikitext(title)
      if (wikitext === null) continue
      const expanded = expandTransclusions(wikitext, definitions).wikitext
      for (const call of ['{{RareDropTable', '{{GemDropTable', '{{GWDRDT']) {
        // Present before => still present after. Inlining one would undo
        // Phase 3's shared records and break the access extractor.
        if (wikitext.includes(call)) expect(expanded).toContain(call)
      }
    }
  })
})
