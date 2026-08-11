import { describe, expect, it } from 'vitest'
import { buildTableGroups, groupByHeading } from '../src/parse/build-tables.js'
import type { WikitextDropLine } from '../src/parse/wikitext-drops.js'

function line(overrides: Partial<WikitextDropLine> & Pick<WikitextDropLine, 'name' | 'rarity'>): WikitextDropLine {
  return {
    heading: '',
    quantity: '1',
    members: false,
    freeToPlay: false,
    noted: false,
    gemwNo: false,
    nameNotes: '',
    isClue: false,
    ...overrides,
  }
}

describe('groupByHeading', () => {
  it('preserves document order and groups by heading', () => {
    const lines = [
      line({ name: 'A', rarity: 'Always', heading: '100%' }),
      line({ name: 'B', rarity: '1/2', heading: 'Main' }),
      line({ name: 'C', rarity: 'Always', heading: '100%' }),
    ]
    const blocks = groupByHeading(lines)
    expect(blocks.map((b) => b.heading)).toEqual(['100%', 'Main'])
    expect(blocks[0]?.lines).toHaveLength(2)
  })
})

describe('buildTableGroups', () => {
  it('classifies an all-Always heading as always mode', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Bones', rarity: 'Always', heading: '100%' }),
        line({ name: 'Steak', rarity: 'Always', heading: '100%' }),
      ])
    )
    expect(groups).toEqual([
      expect.objectContaining({ mode: 'always', denominator: null, ambiguous: null }),
    ])
    expect(groups[0]?.entries).toHaveLength(2)
  })

  it('classifies a Tertiary heading as independent regardless of rarity shape', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Clue', rarity: '1/15', heading: 'Tertiary' }),
        line({ name: 'Beef', rarity: '1/1000', heading: 'Tertiary' }),
      ])
    )
    expect(groups[0]?.mode).toBe('independent')
    expect(groups[0]?.ambiguous).toBeNull()
  })

  it('classifies a Pre-roll heading as preroll even when rarities share one denominator', () => {
    // The real Brutus bug: 5/150, 4/150, 1/150 all share denominator 150.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '5/150', heading: 'Pre-roll' }),
        line({ name: 'B', rarity: '4/150', heading: 'Pre-roll' }),
        line({ name: 'C', rarity: '1/150', heading: 'Pre-roll' }),
      ])
    )
    expect(groups[0]?.mode).toBe('preroll')
    expect(groups[0]?.ambiguous).toBeNull()
  })

  it('merges adjacent headings sharing one denominator into one weighted table', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '6/81', heading: 'Armour' }),
        line({ name: 'B', rarity: '30/81', heading: 'Runes' }),
        line({ name: 'C', rarity: '45/81', heading: 'Resources' }),
      ])
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      mode: 'weighted',
      denominator: 81,
      headings: ['Armour', 'Runes', 'Resources'],
    })
    expect(groups[0]?.entries).toHaveLength(3)
  })

  it('does not merge weighted headings across a different mode in between', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '40/81', heading: 'Armour' }),
        line({ name: 'B', rarity: 'Always', heading: '100%' }),
        line({ name: 'C', rarity: '41/81', heading: 'Resources' }),
      ])
    )
    expect(groups.map((g) => g.mode)).toEqual(['weighted', 'always', 'weighted'])
    expect(groups[0]?.denominator).toBe(81)
    expect(groups[2]?.denominator).toBe(81)
  })

  it('does not merge adjacent weighted headings with different denominators', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '40/81', heading: 'Armour' }),
        line({ name: 'B', rarity: '50/100', heading: 'Other' }),
      ])
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]?.denominator).toBe(81)
    expect(groups[1]?.denominator).toBe(100)
  })

  it('treats a heterogeneous-denominator heading with no keyword as an ambiguous preroll guess', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Claws', rarity: '1/196', heading: 'Unique' }),
        line({ name: 'Sword', rarity: '1/256', heading: 'Unique' }),
      ])
    )
    expect(groups[0]?.mode).toBe('preroll')
    expect(groups[0]?.ambiguous).toMatch(/heterogeneous|different denominators/)
  })

  it('flags an unparseable rarity instead of silently dropping the row', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Key', rarity: '{{Brimstone rarity|225}}', heading: 'Tertiary Extra' }),
      ])
    )
    expect(groups[0]?.ambiguous).toMatch(/unparseable rarity/)
    expect(groups[0]?.entries).toHaveLength(0)
  })

  it('carries members/freeToPlay flags and noted through to the parsed entry', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Seed', rarity: '10/81', heading: 'Seeds', members: true }),
        line({ name: 'Steak', rarity: '10/81', heading: 'Seeds', noted: true, members: true }),
      ])
    )
    expect(groups[0]?.entries[0]).toMatchObject({ members: true, freeToPlay: false })
    expect(groups[0]?.entries[1]).toMatchObject({ noted: true })
  })
})
