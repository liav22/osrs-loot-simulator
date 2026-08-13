import { describe, expect, it } from 'vitest'
import { extractRdtAccessLines } from '../src/parse/rdt-access.js'

function drops(body: string): string {
  return `intro\n==Drops==\n${body}\n==Combat Achievements==\nunrelated`
}

describe('extractRdtAccessLines', () => {
  it('extracts a plain single-rate RareDropTable access line (Cerberus shape)', () => {
    const wikitext = drops('===Rare drop table===\n{{RareDropTable|3/130|naturetalisman=yes}}')
    const { lines, unresolved } = extractRdtAccessLines(wikitext)
    expect(unresolved).toEqual([])
    expect(lines).toEqual([
      {
        ref: 'rare_drop_table',
        rate: { num: 3, den: 130 },
        rolls: 1,
        variant: null,
        approx: false,
        qtyMultiplier: null,
        drawsPerHit: null,
        raw: '{{RareDropTable|3/130|naturetalisman=yes}}',
      },
    ])
  })

  it('splits a two-rate RareDropTable call into separate RDT and gem access lines (Giant Mole shape)', () => {
    const wikitext = drops('===Rare and Gem drop table===\n{{RareDropTable|4/131|6/131|naturetalisman=yes}}')
    const { lines } = extractRdtAccessLines(wikitext)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ ref: 'rare_drop_table', rate: { num: 4, den: 131 } })
    expect(lines[1]).toMatchObject({ ref: 'gem_drop_table', rate: { num: 6, den: 131 } })
  })

  it('extracts a GemDropTable-only access line with no RDT reference (Kraken shape)', () => {
    const wikitext = drops('===Gem drop table===\n{{GemDropTable|2/128|naturetalisman=yes|chaostalisman=yes}}')
    const { lines } = extractRdtAccessLines(wikitext)
    expect(lines).toEqual([
      expect.objectContaining({ ref: 'gem_drop_table', rate: { num: 2, den: 128 } }),
    ])
  })

  it('reads rolls, dropversion and approx regardless of parameter order (Amoxliatl shape)', () => {
    const wikitext = drops('===Gem drop table===\n{{GemDropTable|naturetalisman=yes|2/58|rolls=2|dropversion=Post-quest}}')
    const { lines } = extractRdtAccessLines(wikitext)
    expect(lines).toEqual([
      {
        ref: 'gem_drop_table',
        rate: { num: 2, den: 58 },
        rolls: 2,
        variant: 'Post-quest',
        approx: false,
        qtyMultiplier: null,
        drawsPerHit: null,
        raw: '{{GemDropTable|naturetalisman=yes|2/58|rolls=2|dropversion=Post-quest}}',
      },
    ])
  })

  it('records approx=Yes, and reads multiplier=N as a modelled quantity scaling (Abyssal Sire / Araxxor shapes)', () => {
    const approxOnly = extractRdtAccessLines(drops('===Rare drop table===\n{{RareDropTable|1/115|approx=Yes|naturetalisman=yes}}'))
    expect(approxOnly.lines[0]).toMatchObject({ approx: true, qtyMultiplier: null })

    // Abyssal Sire verbatim: "always drop double the usual quantity from this table".
    const withMultiplier = extractRdtAccessLines(
      drops('===Rare drop table===\n{{RareDropTable|3/139|naturetalisman=yes|override=text|multiplier=2}}')
    )
    expect(withMultiplier.lines[0]).toMatchObject({ qtyMultiplier: 2, drawsPerHit: null, rolls: 1 })
  })

  it("reads Corporeal Beast's prose as one access gating K draws, not K access attempts", () => {
    const { lines } = extractRdtAccessLines(
      drops(
        '===Gem drop table===\n{{GemDropTable|12/512|naturetalisman=yes|rolls=10|override=There is a ' +
          '12/512 chance of rolling the [[gem drop table]], whereupon its contents are rolled 10 times.}}'
      )
    )
    // rolls collapses to 1: the two readings are mutually exclusive.
    expect(lines[0]).toMatchObject({ ref: 'gem_drop_table', rolls: 1, drawsPerHit: 10 })
  })

  it('leaves rolls=N alone when the prose does not claim the inverted reading', () => {
    // Phantom Muspah's real shape — structurally identical to Corporeal Beast
    // apart from the prose, and it genuinely means 2 independent attempts.
    const { lines } = extractRdtAccessLines(
      drops('===Rare drop table===\n{{RareDropTable|5/235|rolls=2|naturetalisman=yes}}')
    )
    expect(lines[0]).toMatchObject({ rolls: 2, drawsPerHit: null })
  })

  it('refuses to guess when the prose and rolls= disagree', () => {
    const { lines, unresolved } = extractRdtAccessLines(
      drops(
        '===Gem drop table===\n{{GemDropTable|12/512|rolls=3|override=whereupon its contents are rolled 10 times.}}'
      )
    )
    expect(lines).toEqual([])
    expect(unresolved[0]?.reason).toMatch(/disagree/)
  })

  it('flags {{GWDRDT}} as unresolved instead of guessing a rate (Kree\'arra / General Graardor shape)', () => {
    const wikitext = drops('===Rare drop table===\n{{GWDRDT}}')
    const { lines, unresolved } = extractRdtAccessLines(wikitext)
    expect(lines).toEqual([])
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.reason).toMatch(/God Wars Dungeon-variant/)
    expect(unresolved[0]?.raw).toBe('{{GWDRDT}}')
  })

  it('flags an unreadable rate instead of silently dropping the line', () => {
    const wikitext = drops('===Rare drop table===\n{{RareDropTable|see prose below}}')
    const { lines, unresolved } = extractRdtAccessLines(wikitext)
    expect(lines).toEqual([])
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.reason).toMatch(/could not be read/)
  })

  it('returns nothing for a page with no RDT/gem-table access at all', () => {
    const wikitext = drops('===100%===\n{{DropsLine|name=Bones|quantity=1|rarity=Always}}')
    expect(extractRdtAccessLines(wikitext)).toEqual({ lines: [], unresolved: [] })
  })
})
