import { describe, expect, it } from 'vitest'
import { extractDropLines } from '../src/parse/wikitext-drops.js'

const BRUTUS_LIKE = `
Some prose before the section.

==Drops==
{{Average drop value|mob=Test}}

===100%===
{{DropsTableHead}}
{{DropsLine|name=Bull bones|quantity=1|rarity=Always}}
{{DropsTableBottom}}

===Pre-roll===
{{DropsTableHead}}
{{DropsLine|name=Mooleta|quantity=1|rarity=5/150}}
{{DropsLine|name=Bottomless milk bucket (empty)|quantity=1|rarity=4/150|namenotes={{(m)}}}}
{{DropsTableBottom}}

===Resources===
{{DropsTableHead}}
{{DropsLine|name=Raw t-bone steak|quantity=3 (noted)|rarity=10/81|namenotes={{(m)}}}}
{{DropsTableBottom}}

==Dialogue==
Not a drops section.
`

describe('extractDropLines', () => {
  it('returns nothing when there is no Drops heading', () => {
    expect(extractDropLines('==Location==\nNothing here.\n==Dialogue==\nMore.')).toEqual([])
  })

  it('extracts DropsLine calls grouped by heading', () => {
    const lines = extractDropLines(BRUTUS_LIKE)
    const byHeading = new Map<string, number>()
    for (const line of lines) byHeading.set(line.heading, (byHeading.get(line.heading) ?? 0) + 1)
    expect(byHeading.get('100%')).toBe(1)
    expect(byHeading.get('Pre-roll')).toBe(2)
    expect(byHeading.get('Resources')).toBe(1)
  })

  it('stops at the section after Dialogue', () => {
    const lines = extractDropLines(BRUTUS_LIKE)
    expect(lines.some((line) => line.name.includes('Not a drops'))).toBe(false)
  })

  it('parses "(noted)" out of the quantity string and sets the noted flag', () => {
    const lines = extractDropLines(BRUTUS_LIKE)
    const steak = lines.find((line) => line.name === 'Raw t-bone steak')
    expect(steak?.quantity).toBe('3 (noted)')
    expect(steak?.noted).toBe(true)
  })

  it('detects a members-only marker from namenotes', () => {
    const lines = extractDropLines(BRUTUS_LIKE)
    const bucket = lines.find((line) => line.name.startsWith('Bottomless'))
    expect(bucket?.members).toBe(true)
    expect(bucket?.freeToPlay).toBe(false)
  })

  it('does not treat DropsLineClue f2p=yes as a membership marker', () => {
    const wikitext = `intro\n==Drops==\n===Tertiary===\n{{DropsTableHead}}\n{{DropsLineClue|type=easy|quantity=1|rarity=1/40|f2p=yes}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines[0]?.members).toBe(false)
    expect(lines[0]?.freeToPlay).toBe(false)
    expect(lines[0]?.name).toBe('Clue scroll (easy)')
  })

  it('handles a heading level other than H2 for the Drops section (Gemstone Crab shape)', () => {
    const wikitext = `intro\n===Drops===\n{{DropsTableHead}}\n{{DropsLine|name=Gem|quantity=1|rarity=1/32}}\n{{DropsTableBottom}}\n===Trivia===\nend`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Gem')
  })

  it('matches a "Rewards" section (Barrows shape), not an unrelated "Reward mechanics" sibling', () => {
    const wikitext =
      `intro\n==Rewards==\n===Main table===\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Coins|quantity=2-774|rarity=379/1012}}\n{{DropsTableBottom}}\n` +
      `==Reward mechanics==\n===Number of rolls===\nprose about the maths, no template calls`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Coins')
  })

  it('collapses a heading nested deeper than the section minimum into its ancestor', () => {
    // Barrows shape: ===Pre-roll=== containing ====Ahrim's==== / ====Dharok's====
    const wikitext =
      `intro\n==Rewards==\n===Pre-roll===\nintro\n====Ahrim's====\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Ahrim's hood|quantity=1|rarity=1/2448}}\n{{DropsTableBottom}}\n` +
      `====Dharok's====\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Dharok's helm|quantity=1|rarity=1/2448}}\n{{DropsTableBottom}}\n` +
      `===Main table===\n{{DropsTableHead}}\n{{DropsLineReward|name=Coins|quantity=1|rarity=1/1012}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    const headings = new Set(lines.map((line) => line.heading))
    expect(headings).toEqual(new Set(['Pre-roll', 'Main table']))
    expect(lines.filter((line) => line.heading === 'Pre-roll')).toHaveLength(2)
  })

  it('splits multiple Drops sections on one page (Scurrius shape) into separately-tagged lines', () => {
    const wikitext =
      `intro\n==Drops (MVP/Solo)==\n===100%===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Big bones|quantity=1|rarity=Always}}\n{{DropsTableBottom}}\n` +
      `==Combat Achievements==\nunrelated\n` +
      `==Drops (non-MVP)==\n===100%===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Bones|quantity=1|rarity=Always}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines.map((line) => line.name)).toEqual(['Big bones', 'Bones'])
    // More than one top-level Drops section on the page -> lines are tagged
    // with which one they came from, so a shared sub-heading name ("100%")
    // does not collide across sections.
    expect(lines.map((line) => line.section)).toEqual(['Drops (MVP/Solo)', 'Drops (non-MVP)'])
  })

  it('does not merge identically-named sub-headings from different top-level sections (The Mimic shape)', () => {
    const wikitext =
      `intro\n==Elite drops==\n===Tertiary===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Elite clue|quantity=1|rarity=Always}}\n{{DropsTableBottom}}\n` +
      `==Master drops==\n===Tertiary===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Master clue|quantity=1|rarity=1/50}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(2)
    const elite = lines.find((line) => line.name === 'Elite clue')
    const master = lines.find((line) => line.name === 'Master clue')
    expect(elite?.heading).toBe('Tertiary')
    expect(master?.heading).toBe('Tertiary')
    expect(elite?.section).toBe('Elite drops')
    expect(master?.section).toBe('Master drops')
  })

  it('leaves `section` empty for the common single-Drops-section page', () => {
    const lines = extractDropLines(BRUTUS_LIKE)
    expect(lines.every((line) => line.section === '')).toBe(true)
  })

  it('matches a qualifier-before-"drops" heading (The Mimic shape) but not "Drop mechanics"', () => {
    const wikitext =
      `intro\n==Elite drops==\n===100%===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Clue scroll (elite)|quantity=1|rarity=Always}}\n{{DropsTableBottom}}\n` +
      `==Mechanics==\n===Drop mechanics===\nprose only, no template calls`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Clue scroll (elite)')
  })

  it('keeps a nested {{refn}} inside raritynotes from truncating the DropsLine call', () => {
    const wikitext =
      `intro\n==Drops==\n===Main table===\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Mind rune|quantity=253-336|rarity=125/1012|raritynotes={{refn|group=d|Requires 381 reward potential to roll.}}}}\n` +
      `{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ name: 'Mind rune', quantity: '253-336', rarity: '125/1012' })
  })

  it('does not let two back-to-back nested templates (a "}}}}" seam) desync param splitting', () => {
    // Real shape, from Bryophyta: raritynotes carries a {{Refn|...}} whose own
    // content ends with a nested {{CiteDiscord|...}}, immediately followed —
    // no separator — by a SIBLING {{CiteNews|...|name=keyrate}}. Both close at
    // once, producing a run of four `}` characters. A depth counter that scans
    // one character at a time (rather than skipping the matched pair) finds
    // an extra overlapping "}}" in that run, desyncs by one level, and reads
    // the citation's OWN `name=keyrate` as a TOP-LEVEL param of the outer
    // DropsLine call — silently overwriting the real item name. This shipped
    // a fabricated "keyrate}}" item into data/bosses/bryophyta.json before the
    // fix; see splitTopLevelPipes's comment for the mechanism.
    const wikitext =
      `intro\n==Drops==\n===Tertiary===\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Mossy key|quantity=1|rarity=1/16|raritynotes=` +
      `{{Refn|group=d|prose.{{CiteDiscord|author=Mod Ash|quote=hi|name=krystilia}}}}` +
      `{{CiteNews|title=Stackable Clues|name=keyrate}}}}\n` +
      `{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ name: 'Mossy key', quantity: '1', rarity: '1/16' })
  })
})

/**
 * `DROPS_SECTION_TITLE`'s tight rule (at most one word before "drops"/
 * "rewards") missed four real corpus shapes: Obor/Bryophyta's section-level
 * members/F2P split, and Black demon's two multi-word headings. Reward Chest
 * (The Gauntlet) needed a second, independent fix (`HEADING_PATTERN` — its
 * headings carry an `<span id="...">` anchor whose `=` broke heading
 * DETECTION, before section-title matching ever ran) plus "table" as an
 * alternate terminal keyword.
 *
 * The widened rule is deliberately content-gated, not just word-count-gated —
 * see `LOOSE_DROPS_SECTION_TITLE`'s comment for why "Training and Rewards"
 * (a real corpus heading, pure prose) must still be rejected even though nothing
 * about its word count distinguishes it from the genuine cases.
 */
describe('extractDropLines: the widened multi-word / "table" / span-tag heading rule', () => {
  it('matches a 2-word prefix before "drops" (Obor/Bryophyta shape)', () => {
    const wikitext =
      `intro\n==Members' worlds drops==\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Big bones|quantity=1|rarity=Always}}\n{{DropsTableBottom}}\n` +
      `==Free-to-play worlds drops==\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Bones|quantity=1|rarity=Always}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines.map((l) => l.name)).toEqual(['Big bones', 'Bones'])
    expect(lines.map((l) => l.section)).toEqual(["Members' worlds drops", 'Free-to-play worlds drops'])
  })

  it('matches a 5-word prefix before "drops" (Black demon shape)', () => {
    const wikitext =
      `intro\n==Level 172, 178, and 184 drops==\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Rune 2h sword|quantity=1|rarity=1/512}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Rune 2h sword')
  })

  it('matches a bare "table" terminal, and strips a trailing <span id="..."> anchor (Reward Chest (The Gauntlet) shape)', () => {
    const wikitext =
      `intro\n==Junk table<span id="Failure"/>==\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Rotten tomato|quantity=1|rarity=1/3|gemw=no}}\n{{DropsTableBottom}}\n` +
      `==Regular loot table<span id="Regular"/>==\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Elder maul|quantity=1|rarity=1/300}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines.map((l) => l.name)).toEqual(['Rotten tomato', 'Elder maul'])
    // The stored section title is the STRIPPED text, not raw wiki markup —
    // checked because it flows into table-id slugs and, if ever rendered, a
    // literal `<span id="Failure"/>` in a user-facing string would be a bug.
    expect(lines.map((l) => l.section)).toEqual(['Junk table', 'Regular loot table'])
  })

  it('does NOT match "Training and Rewards" (Salarin the Twisted shape) — same word count as a real match, but no row content', () => {
    // The precision test: word count alone cannot separate this from
    // "Members' worlds drops" (also a 2-word prefix). Content is the
    // tie-breaker, and this section has none.
    const wikitext =
      `intro\n==Strategy==\n===Training and Rewards===\n` +
      `Prose about training methods, no template calls at all.\n` +
      `===Sinister Key===\nMore prose.\n` +
      `==Drops==\n{{DropsTableHead}}\n` +
      `{{DropsLine|name=Grimy guam leaf|quantity=1|rarity=1/22}}\n{{DropsTableBottom}}`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Grimy guam leaf')
    // And critically: the phantom section must not have flipped `qualify`,
    // tagging the one real section as if the page had more than one.
    expect(lines[0]?.section).toBe('')
  })

  it('still rejects "Drop mechanics"/"Reward mechanics" under the widened rule', () => {
    const wikitext =
      `intro\n==Rewards==\n{{DropsTableHead}}\n` +
      `{{DropsLineReward|name=Coins|quantity=1|rarity=1/2}}\n{{DropsTableBottom}}\n` +
      `==Reward mechanics==\n===Number of rolls===\nprose about the maths, no template calls\n` +
      `==Mechanics==\n===Drop mechanics===\nprose only, no template calls`
    const lines = extractDropLines(wikitext)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Coins')
  })
})
