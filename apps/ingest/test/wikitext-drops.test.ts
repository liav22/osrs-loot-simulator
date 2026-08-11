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
})
