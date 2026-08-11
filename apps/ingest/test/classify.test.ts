import { describe, expect, it } from 'vitest'
import { classify, classifyRows, groupByDenominator } from '../src/triage/classify.js'
import { slugify } from '../src/snapshots/store.js'

/**
 * Fixtures here are synthetic. Real wiki rows are CC BY-NC-SA and live only in
 * `data/` and the gitignored snapshot cache — never under `apps/`, which is MIT.
 * The shape is copied from the live `dropsline` response; the contents are not.
 */

const MEMBERS_SUB = '<sub title="Members-only" style="cursor:help;">(m)</sub>'
const F2P_SUB = '<sub title="Free-to-play" style="cursor:help;">(f)</sub>'

function row(options: {
  item: string
  rarity: string
  notes?: string
  rdt?: boolean
  rolls?: number
  qty?: [number, number]
}) {
  const [low, high] = options.qty ?? [1, 1]
  return {
    page_name: 'Test Monster',
    item_name: options.item,
    rare_drop_table: options.rdt ?? false,
    drop_json: JSON.stringify({
      'Dropped from': 'Test Monster',
      'Dropped item': options.item,
      Rarity: options.rarity,
      'Name Notes': options.notes ?? '',
      'Rarity Notes': '',
      Approx: false,
      Rolls: options.rolls ?? 1,
      'Quantity Low': low,
      'Quantity High': high,
      'Drop Value': 0,
    }),
  }
}

describe('slugify', () => {
  it('produces keys the boss slug regex accepts', () => {
    expect(slugify('Ahrim the Blighted')).toBe('ahrim-the-blighted')
    expect(slugify("Vet'ion")).toBe('vet-ion')
    expect(slugify('Dagannoth Rex')).toBe('dagannoth-rex')
    expect(slugify('K’ril Tsutsaroth')).toBe('k-ril-tsutsaroth')
    for (const title of ['Ahrim the Blighted', "Vet'ion", 'TzTok-Jad']) {
      expect(slugify(title)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })
})

describe('classifyRows', () => {
  it('parses Always, plain fractions and comma-grouped denominators', () => {
    const { rows, unparseableRarities } = classifyRows([
      row({ item: 'Bones', rarity: 'Always' }),
      row({ item: 'Coins', rarity: '10/81' }),
      row({ item: 'Rare thing', rarity: '1/1,000' }),
      row({ item: 'Approx thing', rarity: '~1/500' }),
    ])
    expect(rows[0]?.isAlways).toBe(true)
    expect(rows[1]).toMatchObject({ numerator: 10, denominator: 81, isFraction: true })
    expect(rows[2]).toMatchObject({ numerator: 1, denominator: 1000 })
    expect(rows[3]).toMatchObject({ numerator: 1, denominator: 500 })
    expect(unparseableRarities).toEqual([])
  })

  it('collects rarity strings it cannot read rather than guessing', () => {
    const { unparseableRarities } = classifyRows([
      row({ item: 'Mystery', rarity: 'Varies' }),
      row({ item: 'Other', rarity: 'Common' }),
    ])
    expect(unparseableRarities).toEqual(['Varies', 'Common'])
  })

  it('detects (m) and (f) markers through the wiki markup', () => {
    const { rows } = classifyRows([
      row({ item: 'Seed', rarity: '5/81', notes: MEMBERS_SUB }),
      row({ item: 'Coins', rarity: '5/81', notes: F2P_SUB }),
      row({ item: 'Shared', rarity: '5/81' }),
    ])
    expect(rows[0]).toMatchObject({ members: true, freeToPlay: false })
    expect(rows[1]).toMatchObject({ members: false, freeToPlay: true })
    expect(rows[2]).toMatchObject({ members: false, freeToPlay: false })
  })

  it('reports drop_json keys fields.ts does not declare', () => {
    const unknown = {
      page_name: 'Test Monster',
      item_name: 'Thing',
      rare_drop_table: false,
      drop_json: JSON.stringify({ Rarity: '1/10', 'Brand New Field': 'surprise' }),
    }
    expect(classifyRows([unknown]).driftKeys).toEqual(['Brand New Field'])
  })
})

describe('groupByDenominator', () => {
  it('counts an unmarked row toward both membership variants', () => {
    const { rows } = classifyRows([
      row({ item: 'Shared', rarity: '20/81' }),
      row({ item: 'Members', rarity: '25/81', notes: MEMBERS_SUB }),
      row({ item: 'F2P', rarity: '61/81', notes: F2P_SUB }),
      row({ item: 'Shared2', rarity: '36/81' }),
    ])
    const [group] = groupByDenominator(rows)
    expect(group).toMatchObject({
      denominator: 81,
      naiveSum: 142,
      membersSum: 81,
      freeToPlaySum: 117,
      reconcilesFlat: false,
      reconcilesSplit: false,
    })
  })
})

describe('classify', () => {
  const build = (rawRows: unknown[], bucketError: string | null = null) =>
    classify({ title: 'Test Monster', slug: 'test-monster', rawRows, bucketError })

  it('tier E when the page has no drop rows', () => {
    const result = build([])
    expect(result.tier).toBe('E')
    expect(result.reasons[0]).toMatch(/no dropsline rows/)
  })

  it('tier D on a bucket error', () => {
    expect(build([], 'Bucket nope does not exist.').tier).toBe('D')
  })

  it('tier E when every row is Always — the real table is elsewhere', () => {
    const result = build([
      row({ item: 'Ashes', rarity: 'Always' }),
      row({ item: 'Bones', rarity: 'Always' }),
    ])
    expect(result.tier).toBe('E')
    expect(result.reasons[0]).toMatch(/all Always/)
  })

  it('tier E when no denominator group is big enough to be a table', () => {
    const result = build([
      row({ item: 'Key', rarity: '1/100' }),
      row({ item: 'Clue', rarity: '1/128' }),
    ])
    expect(result.tier).toBe('E')
    expect(result.reasons[0]).toMatch(/no denominator group reaches/)
  })

  it('tier D when a rarity is not a fraction', () => {
    const result = build([
      row({ item: 'A', rarity: '40/81' }),
      row({ item: 'B', rarity: '20/81' }),
      row({ item: 'C', rarity: '21/81' }),
      row({ item: 'Mystery', rarity: 'Varies' }),
    ])
    expect(result.tier).toBe('D')
    expect(result.reasons[0]).toMatch(/not fractions/)
  })

  it('tier D when the main table overflows and no split fixes it', () => {
    const result = build([
      row({ item: 'A', rarity: '60/81' }),
      row({ item: 'B', rarity: '60/81' }),
      row({ item: 'C', rarity: '60/81' }),
    ])
    expect(result.tier).toBe('D')
    expect(result.reasons[0]).toMatch(/overflows/)
  })

  it('tier A when a group sums exactly, with no markers', () => {
    const result = build([
      row({ item: 'Bones', rarity: 'Always' }),
      row({ item: 'A', rarity: '40/81' }),
      row({ item: 'B', rarity: '30/81' }),
      row({ item: 'C', rarity: '11/81' }),
      row({ item: 'Clue', rarity: '1/128' }),
    ])
    expect(result.tier).toBe('A')
    expect(result.mainDenominator).toBe(81)
    expect(result.alwaysRows).toBe(1)
    expect(result.reasons[0]).toMatch(/sums exactly/)
  })

  it('tier A when the main table falls short, treating the gap as implicit nothing', () => {
    const result = build([
      row({ item: 'A', rarity: '40/128' }),
      row({ item: 'B', rarity: '30/128' }),
      row({ item: 'C', rarity: '31/128' }),
    ])
    expect(result.tier).toBe('A')
    expect(result.reasons[0]).toMatch(/shortfall 27 is implicit nothing/)
  })

  it('tier B when only the membership split reconciles', () => {
    const result = build([
      row({ item: 'Shared', rarity: '56/81' }),
      row({ item: 'Members', rarity: '25/81', notes: MEMBERS_SUB }),
      row({ item: 'F2P', rarity: '25/81', notes: F2P_SUB }),
    ])
    expect(result.tier).toBe('B')
    expect(result.hasVariantMarkers).toBe(true)
    const [group] = result.groups
    expect(group?.naiveSum).toBe(106)
    expect(group?.membersSum).toBe(81)
    expect(group?.freeToPlaySum).toBe(81)
  })

  it('tier C outranks B when the rare drop table is reachable', () => {
    const result = build([
      row({ item: 'Shared', rarity: '56/81' }),
      row({ item: 'Members', rarity: '25/81', notes: MEMBERS_SUB }),
      row({ item: 'F2P', rarity: '25/81', notes: F2P_SUB }),
      row({ item: 'Rare drop table', rarity: '1/128', rdt: true }),
    ])
    expect(result.tier).toBe('C')
    expect(result.reasons.join(' ')).toMatch(/variant markers/)
  })

  it('does not penalise a preroll or tertiary group for not summing', () => {
    // 10/150 and 1/128 never sum to their denominators; only the /81 group is
    // the main table, because only it clears MIN_MAIN_TABLE_ROWS.
    const result = build([
      row({ item: 'Unique', rarity: '5/150' }),
      row({ item: 'Unique2', rarity: '5/150' }),
      row({ item: 'A', rarity: '40/81' }),
      row({ item: 'B', rarity: '30/81' }),
      row({ item: 'C', rarity: '11/81' }),
      row({ item: 'Clue', rarity: '1/128' }),
    ])
    expect(result.tier).toBe('A')
    expect(result.mainDenominator).toBe(81)
  })

  it('flags rows declaring more than one roll', () => {
    const result = build([row({ item: 'A', rarity: '81/81', rolls: 2 })])
    expect(result.multiRollRows).toBe(1)
    expect(result.reasons.join(' ')).toMatch(/rolls > 1/)
  })
})
