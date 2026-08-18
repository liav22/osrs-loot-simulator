import { describe, expect, it } from 'vitest'
import { buildTableGroups, checkBundleSignals, groupByHeading } from '../src/parse/build-tables.js'
import type { WikitextDropLine } from '../src/parse/wikitext-drops.js'

function line(overrides: Partial<WikitextDropLine> & Pick<WikitextDropLine, 'name' | 'rarity'>): WikitextDropLine {
  return {
    heading: '',
    section: '',
    quantity: '1',
    members: false,
    freeToPlay: false,
    noted: false,
    gemwNo: false,
    nameNotes: '',
    rarityNotes: '',
    isClue: false,
    // Defaults to a row written directly on the page. A test that wants the
    // transclusion path sets these explicitly — see the partition suite.
    expandedFrom: '',
    accessRate: '',
    variant: null,
    blockPreamble: '',
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

  it('keeps identically-named sub-headings from different sections as separate blocks (The Mimic shape)', () => {
    const lines = [
      line({ name: 'Elite clue', rarity: 'Always', heading: 'Tertiary', section: 'Elite drops' }),
      line({ name: 'Master clue', rarity: '1/50', heading: 'Tertiary', section: 'Master drops' }),
    ]
    const blocks = groupByHeading(lines)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ heading: 'Tertiary', lines: [lines[0]] })
    expect(blocks[1]).toMatchObject({ heading: 'Tertiary', lines: [lines[1]] })
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

  it('splits an Always row out of a Pre-roll heading instead of rejecting it', () => {
    // Monumental chest's real shape: Cabbage/Message are `rarity=Always`
    // consolation rows sitting beside a genuine preroll chain under one
    // `===Pre-roll===` heading. `preroll`'s schema correctly rejects an
    // inline `always` entry — checked in order, first hit short-circuits, so
    // an always-rate entry would deterministically win every kill and make
    // everything after it (including the real chain) unreachable.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Cabbage', rarity: 'Always', heading: 'Pre-roll' }),
        line({ name: 'A', rarity: '5/150', heading: 'Pre-roll' }),
        line({ name: 'B', rarity: '4/150', heading: 'Pre-roll' }),
      ])
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ mode: 'always', ambiguous: null })
    expect(groups[0]?.entries.map((e) => e.name)).toEqual(['Cabbage'])
    expect(groups[1]).toMatchObject({ mode: 'preroll', ambiguous: null })
    expect(groups[1]?.entries.map((e) => e.name)).toEqual(['A', 'B'])
  })

  it('reclassifies a Pre-roll heading as weighted when its rows reconcile flush to one denominator', () => {
    // Monumental chest's real unique-selection rows (8+2+2+2+2+2+1 = 19)
    // sum EXACTLY to their shared denominator — a normalised weighted split
    // the wiki happens to label by WHEN it resolves ("pre-roll" in the
    // raid's timeline), not by HOW it behaves. A genuine preroll (Brutus:
    // 5+4+1 = 10 against /150) does NOT reconcile, because the shortfall IS
    // the "nothing, keep going" case that makes it a real ordered chain.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Hilt', rarity: '8/19', heading: 'Pre-roll' }),
        line({ name: 'Rapier', rarity: '2/19', heading: 'Pre-roll' }),
        line({ name: 'Staff', rarity: '2/19', heading: 'Pre-roll' }),
        line({ name: 'Faceguard', rarity: '2/19', heading: 'Pre-roll' }),
        line({ name: 'Chestguard', rarity: '2/19', heading: 'Pre-roll' }),
        line({ name: 'Legguards', rarity: '2/19', heading: 'Pre-roll' }),
        line({ name: 'Scythe', rarity: '1/19', heading: 'Pre-roll' }),
      ])
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ mode: 'weighted', denominator: 19, ambiguous: null })
    expect(groups[0]?.entries).toHaveLength(7)
    expect(groups[0]?.entries.find((e) => e.name === 'Hilt')?.weight).toBe(8)
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

  /**
   * A latent risk the section-level membership fallback (`assemble-boss.ts`'s
   * `conditionsFor`) makes real: merging across a section boundary would
   * produce one table whose entries came from TWO different sections, with no
   * single section left to attribute a fallback `members` condition to.
   * Not yet observed in the real corpus (no two adjacent cross-section blocks
   * currently share a denominator), closed defensively since it's the same
   * section-tracking data, not a separate fix.
   */
  it('does not merge adjacent weighted headings sharing a denominator across a section boundary', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '40/81', heading: 'Weapons', section: "Members' worlds drops" }),
        line({ name: 'B', rarity: '41/81', heading: 'Weapons', section: 'Free-to-play worlds drops' }),
      ])
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ denominator: 81, section: "Members' worlds drops" })
    expect(groups[1]).toMatchObject({ denominator: 81, section: 'Free-to-play worlds drops' })
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
    expect(groups[0]?.confirmedBy).toBeUndefined()
  })

  it('splits Always rows out of a heading with no Pre-roll/Tertiary keyword before merging the rest (Yama "Contract" shape)', () => {
    // Yama's real shape: 18 `rarity=Always` rows (a contract's guaranteed
    // rewards) plus one `1/100` chance row (`Yami`), under a heading named
    // "Contract" — no keyword the earlier branches recognise. Before the
    // mixed-Always split ran here, this fell into the homogeneous-denominator
    // merge path with only `Yami`'s fixed rate contributing to `denominators`
    // (size 1, from its own `/100`), so EVERY row — the 18 Always ones
    // included — got merged onto that single denominator. `toEntry`'s weight
    // formula gave each Always row (`num: 1, den: 1`) a weight equal to the
    // whole denominator, shipping 18 rows at `weight: 100` against
    // `denominator: 100`.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Aether catalyst', rarity: 'Always', heading: 'Contract' }),
        line({ name: 'Diabolic worms', rarity: 'Always', heading: 'Contract' }),
        line({ name: 'Oathplate helm', rarity: 'Always', heading: 'Contract' }),
        line({ name: 'Yami', rarity: '1/100', heading: 'Contract' }),
      ])
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ mode: 'always', ambiguous: null })
    expect(groups[0]?.entries.map((e) => e.name)).toEqual([
      'Aether catalyst',
      'Diabolic worms',
      'Oathplate helm',
    ])
    // `Yami` alone is the only fixed row left, so it merges into a trivial
    // one-row weighted table on its own denominator (weight 1 of 100) —
    // legitimate, since a lone item is not overflowing anything. The point
    // of this test is that it is no longer folded into a bogus 4-row
    // `weighted` table where the three Always rows each got `weight: 100`.
    expect(groups[1]?.entries.map((e) => e.name)).toEqual(['Yami'])
    expect(groups[1]).toMatchObject({ mode: 'weighted', denominator: 100 })
    expect(groups[1]?.entries[0]?.weight).toBe(1)
  })

  describe('heterogeneous-denominator resolution (no keyword, no Always)', () => {
    it('homogenises a clean-multiple outlier into the weighted table (Kraken shape)', () => {
      const groups = buildTableGroups(
        groupByHeading([
          line({ name: 'Mystic water staff', rarity: '3/128', heading: 'Weapons and armour' }),
          line({ name: 'Rune warhammer', rarity: '2/128', heading: 'Weapons and armour' }),
          line({ name: 'Mystic robe top', rarity: '1/128', heading: 'Weapons and armour' }),
          line({ name: 'Trident of the seas (full)', rarity: '1/512', heading: 'Weapons and armour' }),
        ])
      )
      expect(groups).toHaveLength(1)
      expect(groups[0]?.mode).toBe('weighted')
      expect(groups[0]?.ambiguous).toBeNull()
      expect(groups[0]?.denominator).toBe(512)
      const trident = groups[0]?.entries.find((e) => e.name === 'Trident of the seas (full)')
      expect(trident?.weight).toBe(1) // 1/512 against a 512 denominator: unscaled
      const staff = groups[0]?.entries.find((e) => e.name === 'Mystic water staff')
      expect(staff?.weight).toBe(12) // 3/128 rescaled to /512: 3 * (512/128) = 12
    })

    it('refuses to homogenise when the merge would overflow the denominator (Gemstone Crab shape)', () => {
      // Seven gems already sum to exactly their own denominator (32/32, no
      // slack) — merging Uncut dragonstone's 1/500 into the same pool would
      // overflow it, so this must stay flagged, not silently overflow.
      const groups = buildTableGroups(
        groupByHeading([
          line({ name: 'Uncut opal', rarity: '9/32', heading: 'Drops' }),
          line({ name: 'Uncut jade', rarity: '9/32', heading: 'Drops' }),
          line({ name: 'Uncut red topaz', rarity: '6/32', heading: 'Drops' }),
          line({ name: 'Uncut sapphire', rarity: '3/32', heading: 'Drops' }),
          line({ name: 'Uncut emerald', rarity: '2/32', heading: 'Drops' }),
          line({ name: 'Uncut ruby', rarity: '2/32', heading: 'Drops' }),
          line({ name: 'Uncut diamond', rarity: '1/32', heading: 'Drops' }),
          line({ name: 'Uncut dragonstone', rarity: '1/500', heading: 'Drops' }),
        ])
      )
      // trySplitDominantAndOutliers picks this up instead (7 dominant + 1 outlier).
      expect(groups).toHaveLength(2)
      const pool = groups.find((g) => g.entries.length === 7)
      const outlier = groups.find((g) => g.entries.length === 1)
      expect(pool?.mode).toBe('weighted')
      expect(pool?.denominator).toBe(32)
      expect(pool?.ambiguous).toBeNull()
      expect(outlier?.mode).toBe('independent')
      expect(outlier?.entries[0]?.name).toBe('Uncut dragonstone')
    })

    it('splits a dominant pool from outliers even when an outlier is MORE common than the pool (Hespori shape)', () => {
      // Regression test: an earlier version required outliers to have a
      // LARGER denominator (rarer) than the dominant pool and silently
      // failed to split Hespori's Main table, where Bottomless compost
      // bucket (1/35) is more common than several /80 seeds.
      const seeds = Array.from({ length: 32 }, (_, i) =>
        line({ name: `Seed ${i}`, rarity: '2/80', heading: 'Main table' })
      )
      const groups = buildTableGroups(
        groupByHeading([
          ...seeds,
          line({ name: 'Bottomless compost bucket', rarity: '1/35', heading: 'Main table' }),
          line({ name: 'Tangleroot', rarity: '1/5375', heading: 'Main table' }),
        ])
      )
      expect(groups).toHaveLength(2)
      const pool = groups.find((g) => g.denominator === 80)
      const outliers = groups.find((g) => g.mode === 'independent')
      expect(pool?.entries).toHaveLength(32)
      expect(outliers?.entries.map((e) => e.name).sort()).toEqual(['Bottomless compost bucket', 'Tangleroot'])
    })

    it('confirms preroll from a footnote shared by multiple entries (Artio "Uniques" shape)', () => {
      const groups = buildTableGroups(
        groupByHeading([
          line({
            name: 'Dragon 2h sword',
            rarity: '1/358',
            heading: 'Uniques',
            rarityNotes: '{{CiteNews|title=Poll 78 Updates|name=news}}',
          }),
          line({ name: 'Dragon pickaxe', rarity: '1/358', heading: 'Uniques', rarityNotes: '<ref name="news"/>' }),
          line({ name: 'Claws of callisto', rarity: '1/618', heading: 'Uniques', rarityNotes: '<ref name="news"/>' }),
        ])
      )
      expect(groups[0]?.mode).toBe('preroll')
      expect(groups[0]?.ambiguous).toBeNull()
      expect(groups[0]?.confirmedBy).toMatch(/cite the same footnote \('news'\)/)
    })

    it('confirms preroll from an explicit mutual-exclusivity phrase when neither denominator signal fires', () => {
      // Two entries each at two DIFFERENT, non-multiple denominators: too
      // small a majority for trySplitDominantAndOutliers (needs >= 3), and
      // an LCM far past the merge cap — the confirming phrase is the only
      // signal left. (Real DT2 boss "Uniques" headings, e.g. Vardorvis',
      // actually resolve via the LCM path instead, since their two
      // denominators happen to be a clean 3x multiple — this case is
      // deliberately synthetic to isolate the phrase-only path.)
      const groups = buildTableGroups(
        groupByHeading([
          line({
            name: 'Ultor vestige',
            rarity: '1/1088',
            heading: 'Uniques',
            rarityNotes: 'the player must roll an invisible drop on the tradeable unique table.',
          }),
          line({ name: 'Chromium ingot', rarity: '3/1088', heading: 'Uniques' }),
          line({ name: 'Virtus mask', rarity: '1/777', heading: 'Uniques' }),
          line({ name: 'Virtus robe top', rarity: '1/777', heading: 'Uniques' }),
        ])
      )
      expect(groups).toHaveLength(1)
      expect(groups[0]?.mode).toBe('preroll')
      expect(groups[0]?.ambiguous).toBeNull()
      expect(groups[0]?.confirmedBy).toMatch(/tradeable unique table/)
    })

    it('stays a flagged guess when no denominator or textual signal resolves it (The Nightmare shape)', () => {
      const groups = buildTableGroups(
        groupByHeading([
          line({ name: 'Nightmare staff', rarity: '1/300', heading: 'Uniques' }),
          line({ name: "Inquisitor's great helm", rarity: '1/420', heading: 'Uniques' }),
          line({ name: "Inquisitor's mace", rarity: '1/750', heading: 'Uniques' }),
          line({ name: 'Eldritch orb', rarity: '1/960', heading: 'Uniques' }),
        ])
      )
      expect(groups).toHaveLength(1)
      expect(groups[0]?.mode).toBe('preroll')
      expect(groups[0]?.ambiguous).toMatch(/different denominators/)
      expect(groups[0]?.confirmedBy).toBeUndefined()
    })
  })

  it('flags an unparseable rarity instead of silently dropping the row', () => {
    const groups = buildTableGroups(
      groupByHeading([line({ name: 'Key', rarity: '1/x', heading: 'Tertiary Extra' })])
    )
    expect(groups[0]?.ambiguous).toMatch(/unparseable rarity/)
    expect(groups[0]?.entries).toHaveLength(0)
  })

  it('flags an unregistered rarity template by name instead of silently guessing', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Key', rarity: '{{Some unknown template|225}}', heading: 'Tertiary Extra' }),
      ])
    )
    expect(groups[0]?.ambiguous).toMatch(/unrecognised rarity template 'Some unknown template'/)
    expect(groups[0]?.entries).toHaveLength(0)
  })

  it('resolves a registered rarity template and attaches its condition', () => {
    // Scorpia: combat level 225 -> Brimstone key at 1/75, gated on a slayer task.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Brimstone key', rarity: '{{Brimstone rarity|225}}', heading: 'Tertiary' }),
      ])
    )
    expect(groups[0]?.mode).toBe('independent')
    expect(groups[0]?.ambiguous).toBeNull()
    expect(groups[0]?.entries[0]?.rarity).toEqual({ kind: 'fixed', num: 1, den: 75 })
    expect(groups[0]?.entries[0]?.extraConditions).toEqual([{ kind: 'onSlayerTask', value: true }])
  })

  it('applies the bonus=yes multiplier (Grotesque Guardians: combat 328, bonus -> 1/44)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Brimstone key', rarity: '{{Brimstone rarity|328|bonus=yes}}', heading: 'Tertiary' }),
      ])
    )
    expect(groups[0]?.entries[0]?.rarity).toEqual({ kind: 'fixed', num: 1, den: 44 })
  })

  it('does not merge two sections\' identically-named Tertiary headings into one table (The Mimic shape)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Elite clue', rarity: '1/15', heading: 'Tertiary', section: 'Elite drops' }),
        line({ name: 'Master clue', rarity: '1/8', heading: 'Tertiary', section: 'Master drops' }),
      ])
    )
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.mode === 'independent' && g.ambiguous === null)).toBe(true)
    expect(groups[0]?.entries).toHaveLength(1)
    expect(groups[0]?.entries[0]?.name).toBe('Elite clue')
    expect(groups[1]?.entries).toHaveLength(1)
    expect(groups[1]?.entries[0]?.name).toBe('Master clue')
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

/**
 * The access-rate identity, and the mode it decides.
 *
 * The question it answers: are these rows one roll that picks one item, or a
 * set of independent rolls? An earlier candidate signal — "every rate derives
 * from one `{{#vardefine:}}` base" — was rejected on evidence, because
 * `Uniques/Corporeal Beast` has no `#vardefine` at all and is provably
 * mutually exclusive. Provenance is not the mechanism; the arithmetic is.
 */
describe('transclusionPartition', () => {
  /**
   * Rows carrying DECIMAL denominators, which is what the real sub-tables
   * publish (`1/416.7`) and why they reach the heterogeneous fallback at all:
   * `tryHomogenizeDenominators` requires integer denominators, so a fixture
   * built from tidy fractions would merge into one `weighted` table before the
   * partition check is ever consulted. That is correct behaviour — a weighted
   * table has no suppression side-effect and its marginals are exact, so a
   * sub-table that homogenises needs none of this machinery (Corporeal Beast's
   * sigils take exactly that path).
   */
  const decimalRows = (denominators: readonly number[]): string[] =>
    denominators.map((d) => `1/${d.toFixed(1)}`)

  const fromTemplate = (
    template: string,
    accessRate: string,
    rarities: readonly string[]
  ): WikitextDropLine[] =>
    rarities.map((rarity, i) =>
      line({ name: `Item ${i}`, rarity, heading: 'Sub-table', expandedFrom: template, accessRate })
    )

  /** The access rate a set of rows would sum to exactly, as the page would write it. */
  const exactAccessFor = (rarities: readonly string[]): string => {
    const sum = rarities.reduce((total, r) => {
      const [n, d] = r.split('/').map(Number) as [number, number]
      return total + n / d
    }, 0)
    return `1/${(1 / sum).toFixed(4)}`
  }

  const SUB_TABLE = decimalRows([300.6, 601.2, 1202.4])

  it('confirms a partition when the rows sum to the declared access rate', () => {
    const lines = fromTemplate('seeddroplines', exactAccessFor(SUB_TABLE), SUB_TABLE)
    const groups = buildTableGroups(groupByHeading(lines))
    expect(groups[0]?.partition?.verdict).toBe('partition')
    expect(groups[0]?.partition?.ratio).toBeCloseTo(1, 3)
    expect(groups[0]?.mode).toBe('independent')
  })

  it('refuses when the rows do not sum to it, rather than rounding toward yes', () => {
    // Vorkath's real shape: two rows carry EFFECTIVE chances folding in the
    // main table's own seed slots, so the block overshoots its access rate.
    const lines = fromTemplate('treeherbseeddroplines', '1/600.0', SUB_TABLE)
    const groups = buildTableGroups(groupByHeading(lines))
    expect(groups[0]?.partition?.verdict).toBe('not-a-partition')
    expect(groups[0]?.partition?.ratio).toBeGreaterThan(2)
  })

  it('abstains when the transclusion declares no access rate at all', () => {
    // WildernessSlayerDropTable: Larran's key derives from the monster's
    // combat level, Slayer's enchantment from its hitpoints. Two independent
    // rolls, and nothing for the identity to test.
    const lines = fromTemplate('wildernessslayerdroptable', '', decimalRows([50.5, 30.5]))
    const groups = buildTableGroups(groupByHeading(lines))
    expect(groups[0]?.partition?.verdict).toBe('no-access-rate')
  })

  it('says nothing about a block written directly on the page', () => {
    const groups = buildTableGroups(
      groupByHeading(
        decimalRows([300.6, 601.2, 1202.4]).map((rarity, i) =>
          line({ name: `Item ${i}`, rarity, heading: 'Uniques' })
        )
      )
    )
    expect(groups[0]?.partition).toBeUndefined()
  })

  it('says nothing about a block that MIXES a transclusion with page rows', () => {
    // Half a sub-table is not that sub-table, and its sum would mean nothing.
    const lines = [
      ...fromTemplate('seeddroplines', '1/171.8', decimalRows([300.6, 601.2])),
      line({ name: 'Hand-written', rarity: '1/1202.4', heading: 'Sub-table' }),
    ]
    const groups = buildTableGroups(groupByHeading(lines))
    expect(groups[0]?.partition).toBeUndefined()
  })

  it('models a transcluded sub-table as independent, never preroll', () => {
    // The whole point. `preroll` would additionally suppress every later
    // weighted table, which put Arrg's Coal 23.45% under its published rate;
    // `independent` reproduces the wiki exactly. Pinned as a mode assertion so
    // a future tidy-up has to argue with `marginal-rates.test.ts`.
    for (const accessRate of [exactAccessFor(SUB_TABLE), '1/600.0', '']) {
      const lines = fromTemplate('anydroplines', accessRate, SUB_TABLE)
      const groups = buildTableGroups(groupByHeading(lines))
      expect(groups[0]?.mode, `access rate '${accessRate}'`).toBe('independent')
    }
  })

  it('models a confirmed partition as a oneOf at the access rate, and clears the flag', () => {
    // Modelling the single-access-roll shape exactly (a `oneOf` behind one
    // access-rate entry) replaced the `independent`-rows approximation this
    // used to stay flagged for — see docs/DECISIONS.md's transclusion entry.
    const lines = fromTemplate('seeddroplines', exactAccessFor(SUB_TABLE), SUB_TABLE)
    const groups = buildTableGroups(groupByHeading(lines))
    expect(groups[0]?.ambiguous).toBeNull()
    expect(groups[0]?.oneOfAccess).toEqual({ num: 1, den: Number(exactAccessFor(SUB_TABLE).split('/')[1]) })
    expect(groups[0]?.confirmedBy).toMatch(/oneOf/)
    // The rows the oneOf will be built from are untouched — assembleBoss
    // reads `entries` to build its inner entries.
    expect(groups[0]?.entries).toHaveLength(SUB_TABLE.length)
  })

  it('leaves a refused or access-rate-less block as the flagged `independent` approximation', () => {
    // `not-a-partition` (Vorkath) and `no-access-rate` reaching this branch
    // must NOT get the oneOf treatment — the identity didn't confirm a
    // single-access-roll shape to model.
    const refused = buildTableGroups(
      groupByHeading(fromTemplate('treeherbseeddroplines', '1/600.0', SUB_TABLE))
    )
    expect(refused[0]?.oneOfAccess).toBeUndefined()
    expect(refused[0]?.ambiguous).toMatch(/needs a human check/)
  })
})

/**
 * The bundle shape (docs/DECISIONS.md's "bundle shape, assessed" entry): rows
 * that are not competing alternatives at all, but items the wiki states
 * arrive TOGETHER on one access roll. Two signals, confirmed against the real
 * corpus shapes named in each test below — see `findBundleGroups`'s own
 * comment in `build-tables.ts`.
 */
describe('co-drop bundles', () => {
  it('collapses a shared-footnote pair into one entry (K\'ril/Zilyana/chaos-fanatic shape)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Bull bones', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="pair">Bull bones and Cow slippers are always dropped together.</ref>' }),
        line({ name: 'Cow slippers', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="pair"/>' }),
        line({ name: 'Steak', rarity: '8/127', heading: 'Potions' }),
      ])
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.entries).toHaveLength(2)
    const bundleEntry = groups[0]?.entries.find((e) => e.bundle !== undefined)
    expect(bundleEntry?.bundle).toMatchObject({
      heading: 'Potions',
      signal: expect.stringMatching(/footnote 'pair' says "dropped together"/),
    })
    expect(bundleEntry?.bundle?.members.map((m) => m.name)).toEqual(['Bull bones', 'Cow slippers'])
    // The bundle's own weight is the shared per-row rate, not the doubled sum
    // an N-competing-rows reading would have produced (8, not 16).
    expect(bundleEntry?.weight).toBe(8)
  })

  it('collapses two independent footnote pairs under one heading (K\'ril\'s two potion pairs)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A1', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="p1">A1 and A2 are always dropped together.</ref>' }),
        line({ name: 'A2', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="p1"/>' }),
        line({ name: 'B1', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="p2">B1 and B2 are always dropped together.</ref>' }),
        line({ name: 'B2', rarity: '8/127', heading: 'Potions', rarityNotes: '<ref name="p2"/>' }),
      ])
    )
    expect(groups).toHaveLength(1)
    const bundles = groups[0]?.entries.filter((e) => e.bundle !== undefined) ?? []
    expect(bundles).toHaveLength(2)
    expect(bundles.map((b) => b.bundle?.members.map((m) => m.name))).toEqual([
      ['A1', 'A2'],
      ['B1', 'B2'],
    ])
  })

  it('collapses a whole block from prose alone, with no footnote (Maggot King shape)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({
          name: 'Stymphike tartare',
          rarity: '41/159',
          heading: 'Supplies',
          blockPreamble: 'These supplies are dropped together.',
        }),
        line({
          name: 'Dull ancient medal',
          rarity: '41/159',
          heading: 'Supplies',
          blockPreamble: 'These supplies are dropped together.',
        }),
      ])
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.entries).toHaveLength(1)
    const [entry] = groups[0]!.entries
    expect(entry?.bundle?.members.map((m) => m.name)).toEqual(['Stymphike tartare', 'Dull ancient medal'])
    expect(entry?.bundle?.signal).toMatch(/block prose says "dropped together"/)
    // The bundle stands as its own single-outcome table: weighted at its own
    // rate against its own denominator (41/159), not doubled to 82.
    expect(groups[0]?.mode).toBe('weighted')
    expect(groups[0]?.denominator).toBe(159)
    expect(entry?.weight).toBe(41)
  })

  it('does not collapse a block whose prose reads as co-drop but whose rows do not share one rate (Mad Angel shape)', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Shark', rarity: '8/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
        line({ name: 'Yellowfin', rarity: '8/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
        line({ name: 'Prayer potion(2)', rarity: '16/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
      ])
    )
    // No entry collapsed — every row is still its own competing alternative.
    expect(groups.flatMap((g) => g.entries).every((e) => e.bundle === undefined)).toBe(true)
    const signals = checkBundleSignals(groupByHeading([
      line({ name: 'Shark', rarity: '8/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
      line({ name: 'Yellowfin', rarity: '8/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
      line({ name: 'Prayer potion(2)', rarity: '16/150', heading: 'Supply batch', blockPreamble: 'Either sharks or yellowfins drop, bundled with a prayer potion(2).' }),
    ]))
    expect(signals).toEqual([
      expect.objectContaining({ heading: 'Supply batch', confirmed: false }),
    ])
  })

  it('does not fire on prose that never uses a co-drop phrase', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'A', rarity: '1/10', heading: 'Resources', blockPreamble: 'There is a 1/10 chance to roll this table.' }),
        line({ name: 'B', rarity: '1/10', heading: 'Resources' }),
      ])
    )
    expect(groups.flatMap((g) => g.entries).every((e) => e.bundle === undefined)).toBe(true)
  })

  describe('checkBundleSignals', () => {
    it('reports a confirmed bundle for every collapsed group', () => {
      const blocks = groupByHeading([
        line({ name: 'A', rarity: '41/159', heading: 'Supplies', blockPreamble: 'These supplies are dropped together.' }),
        line({ name: 'B', rarity: '41/159', heading: 'Supplies', blockPreamble: 'These supplies are dropped together.' }),
      ])
      const signals = checkBundleSignals(blocks)
      expect(signals).toEqual([
        expect.objectContaining({ heading: 'Supplies', confirmed: true }),
      ])
    })

    it('reports nothing for a block with no bundle signal at all', () => {
      const blocks = groupByHeading([
        line({ name: 'A', rarity: '1/10', heading: 'Resources' }),
        line({ name: 'B', rarity: '1/10', heading: 'Resources' }),
      ])
      expect(checkBundleSignals(blocks)).toEqual([])
    })
  })
})

/**
 * A row whose `raritynotes` explicitly disclaims single-table scope (K'ril
 * Tsutsaroth's/Commander Zilyana's own Coins row) is a THIRD, distinct defect
 * from the bundle shape — docs/DECISIONS.md's "Weight-overflow investigated"
 * entry. It must not be pooled into whatever weighted table its heading
 * would otherwise join.
 */
describe('composite cross-table rates', () => {
  it('splits a composite-rate row into its own independent entry, leaving its siblings weighted', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({
          name: 'Coins',
          rarity: '36.7/127',
          heading: 'Other',
          rarityNotes: 'Coins come from rolls on all loot tables, including the unique table, GDT and RDT.',
        }),
        line({ name: 'Grimy lantadyme', rarity: '8/127', heading: 'Other' }),
        line({ name: 'Death rune', rarity: '8/127', heading: 'Other' }),
      ])
    )
    expect(groups).toHaveLength(2)
    const composite = groups.find((g) => g.entries.some((e) => e.name === 'Coins'))
    expect(composite).toMatchObject({ mode: 'independent', denominator: null })
    expect(composite?.entries).toHaveLength(1)
    expect(composite?.entries[0]?.rarity).toEqual({ kind: 'fixed', num: 36.7, den: 127 })
    expect(composite?.confirmedBy).toMatch(/disclaims single-table scope/)

    const pool = groups.find((g) => g !== composite)
    expect(pool).toMatchObject({ mode: 'weighted', denominator: 127 })
    expect(pool?.entries.map((e) => e.name)).toEqual(['Grimy lantadyme', 'Death rune'])
  })

  it('keeps a composite-rate row merging with an earlier weighted heading at the same denominator (K\'ril shape)', () => {
    // The real defect: Coins used to inflate the SAME merged pool as
    // "Weapons and armour" and "Potions" — splitting it out must not also
    // sever that merge, since those headings genuinely share one draw.
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Rune platebody', rarity: '20/127', heading: 'Weapons and armour' }),
        line({
          name: 'Coins',
          rarity: '36.7/127',
          heading: 'Other',
          rarityNotes: 'Coins come from rolls on all loot tables, including the unique table, GDT and RDT.',
        }),
        line({ name: 'Death rune', rarity: '8/127', heading: 'Other' }),
      ])
    )
    const pool = groups.find((g) => g.mode === 'weighted')
    expect(pool?.headings).toEqual(['Weapons and armour', 'Other'])
    expect(pool?.entries.map((e) => e.name)).toEqual(['Rune platebody', 'Death rune'])
    expect(pool?.denominator).toBe(127)
  })

  it('does not fire on ordinary raritynotes text', () => {
    const groups = buildTableGroups(
      groupByHeading([
        line({ name: 'Coins', rarity: '5/127', heading: 'Other', rarityNotes: 'A common Coins drop.' }),
        line({ name: 'Death rune', rarity: '5/127', heading: 'Other' }),
      ])
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.mode).toBe('weighted')
    expect(groups[0]?.entries).toHaveLength(2)
  })
})
