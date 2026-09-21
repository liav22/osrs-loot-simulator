import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  expectedValue,
  resolveSimContext,
  simulate,
  type Boss,
} from '@osrs-loot-simulator/loot-model'
import { loadAdditionalSources } from '../src/inventory/additional-sources.js'
import { REPO_ROOT } from '../src/snapshots/store.js'

function loadBoss(slug: string): Boss {
  return BossSchema.parse(
    JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'bosses', `${slug}.json`), 'utf8'))
  )
}

const elf = loadBoss('elf-pickpocketing')
const vyre = loadBoss('vyre-pickpocketing')
const masterFarmer = loadBoss('master-farmer')

const cases = [
  {
    label: 'Elf',
    name: 'Elf (pickpocketing)',
    boss: elf,
    denominator: 128,
    main: [
      ['coins', 105],
      ['death-rune', 8],
      ['nature-rune', 5],
      ['jug-of-wine', 6],
      ['diamond', 1],
      ['fire-orb', 2],
      ['gold-ore', 1],
    ] as const,
    tertiary: [
      ['crystal-shard', 1, 35],
      ['enhanced-crystal-teleport-seed', 1, 1024],
    ] as const,
    unique: 'enhanced-crystal-teleport-seed',
  },
  {
    label: 'Vyre',
    name: 'Vyre (pickpocketing)',
    boss: vyre,
    denominator: 132,
    main: [
      ['coins', 109],
      ['death-rune', 8],
      ['blood-rune', 2],
      ['blood-pint', 6],
      ['uncut-ruby', 5],
      ['diamond', 1],
      ['cooked-mystery-meat', 1],
    ] as const,
    tertiary: [['blood-shard', 1, 5000]] as const,
    unique: 'blood-shard',
  },
] as const

describe.each(cases)('$label pickpocketing', ({ boss, name, denominator, main, tertiary, unique }) => {
  it('preserves the published main and independent rates', () => {
    expect(boss.tables).toHaveLength(2)
    expect(boss.tables[0]).toMatchObject({ mode: 'weighted', denominator })
    expect(boss.tables[1]).toMatchObject({ mode: 'independent' })

    const ev = expectedValue(boss, resolveSimContext(boss, {}))
    const rates = new Map(ev.items.map((item) => [item.itemKey, item.expectedDrops]))
    for (const [itemKey, weight] of main) {
      expect(rates.get(itemKey), itemKey).toBeCloseTo(weight / denominator, 12)
    }
    for (const [itemKey, num, den] of tertiary) {
      expect(rates.get(itemKey), itemKey).toBeCloseTo(num / den, 12)
    }
  })

  it('gives exactly one ordinary reward per successful pickpocket', () => {
    const result = simulate(boss, 20_000, resolveSimContext(boss, {}), 42)
    const drops = new Map(result.drops.map((drop) => [drop.itemKey, drop.drops]))
    expect(main.reduce((sum, [itemKey]) => sum + (drops.get(itemKey) ?? 0), 0)).toBe(20_000)
  })

  it('doubles quantities, not rates, with full rogue equipment', () => {
    const plain = simulate(boss, 20_000, resolveSimContext(boss, { rogueOutfit: false }), 73)
    const rogue = simulate(boss, 20_000, resolveSimContext(boss, { rogueOutfit: true }), 73)
    const rogueByKey = new Map(rogue.drops.map((drop) => [drop.itemKey, drop]))

    for (const drop of plain.drops) {
      const doubled = rogueByKey.get(drop.itemKey)
      expect(doubled?.drops, `${drop.itemKey} rate`).toBe(drop.drops)
      expect(doubled?.quantity, `${drop.itemKey} quantity`).toBe(drop.quantity * 2)
    }
  })

  it('is generated, verified, repeatable, and flags its signature rare reward', () => {
    expect(boss.name).toBe(name)
    expect(boss.aliases).toEqual([])
    expect(boss.source).toBe('generated')
    expect(boss.status).toBe('verified')
    expect(boss.repeatable).toBe(true)
    expect(boss.attemptLabel).toEqual({
      singular: 'successful pickpocket',
      plural: 'successful pickpockets',
    })
    const rareNode = boss.tables
      .flatMap((table) => table.entries)
      .find((entry) => entry.node.kind === 'item' && entry.node.itemKey === unique)?.node
    expect(rareNode).toMatchObject({ kind: 'item', unique: true })
  })
})

describe('Master Farmer pickpocketing', () => {
  const categoryItems = [
    ['potato-seed', 'onion-seed', 'cabbage-seed', 'tomato-seed', 'sweetcorn-seed', 'strawberry-seed', 'watermelon-seed', 'snape-grass-seed'],
    ['barley-seed', 'hammerstone-seed', 'asgarnian-seed', 'jute-seed', 'yanillian-seed', 'krandorian-seed', 'wildblood-seed'],
    ['marigold-seed', 'nasturtium-seed', 'rosemary-seed', 'woad-seed', 'limpwurt-seed'],
    ['redberry-seed', 'cadavaberry-seed', 'dwellberry-seed', 'jangerberry-seed', 'whiteberry-seed', 'poison-ivy-seed'],
    ['mushroom-spore', 'belladonna-seed', 'cactus-seed', 'seaweed-spore', 'potato-cactus-seed'],
    ['guam-seed', 'marrentill-seed', 'tarromin-seed', 'harralander-seed', 'ranarr-seed', 'toadflax-seed', 'irit-seed', 'avantoe-seed', 'kwuarm-seed', 'snapdragon-seed', 'cadantine-seed', 'lantadyme-seed', 'dwarf-weed-seed', 'torstol-seed'],
  ] as const
  const categoryWeights = [485, 243, 122, 97, 5, 48] as const
  const seedKeys = categoryItems.flat()

  function ratesAt(farmingLevel: number, thievingLevel: number) {
    const ev = expectedValue(
      masterFarmer,
      resolveSimContext(masterFarmer, { farmingLevel, thievingLevel })
    )
    return new Map(ev.items.map((item) => [item.itemKey, item]))
  }

  it('selects exactly one seed through the published category partition', () => {
    const main = masterFarmer.tables[0]
    expect(main).toMatchObject({ mode: 'weighted', denominator: 1000 })
    expect(main?.entries.map((entry) => entry.rate)).toEqual(
      categoryWeights.map((weight) => ({ kind: 'weight', weight }))
    )
    expect(main?.entries.map((entry) => entry.node.kind)).toEqual(Array(6).fill('oneOf'))

    const rates = ratesAt(85, 38)
    for (const [index, keys] of categoryItems.entries()) {
      const total = keys.reduce((sum, key) => sum + (rates.get(key)?.expectedDrops ?? 0), 0)
      expect(total, `category ${index}`).toBeCloseTo(categoryWeights[index]! / 1000, 12)
    }
    expect(seedKeys.reduce((sum, key) => sum + (rates.get(key)?.expectedDrops ?? 0), 0)).toBeCloseTo(1, 12)

    const simulated = simulate(masterFarmer, 20_000, resolveSimContext(masterFarmer, {}), 42)
    const drops = new Map(simulated.drops.map((drop) => [drop.itemKey, drop.drops]))
    expect(seedKeys.reduce((sum, key) => sum + (drops.get(key) ?? 0), 0)).toBe(20_000)
  })

  it('matches the Farming-scaled herb rates and the Thieving-scaled Rocky rate', () => {
    const level38 = ratesAt(38, 38)
    const level85 = ratesAt(85, 99)

    expect(level38.get('guam-seed')?.expectedDrops).toBeCloseTo(1 / 58.36, 4)
    expect(level38.get('ranarr-seed')?.expectedDrops).toBeCloseTo(1 / 555.83, 5)
    expect(level38.get('snapdragon-seed')?.expectedDrops).toBeCloseTo(1 / 3835.23, 7)
    expect(level38.get('torstol-seed')?.expectedDrops).toBeCloseTo(1 / 19_176.14, 8)

    expect(level85.get('guam-seed')?.expectedDrops).toBeCloseTo(1 / 67.2, 5)
    expect(level85.get('ranarr-seed')?.expectedDrops).toBeCloseTo(1 / 268.75, 6)
    expect(level85.get('snapdragon-seed')?.expectedDrops).toBeCloseTo(1 / 1854.4, 7)
    expect(level85.get('torstol-seed')?.expectedDrops).toBeCloseTo(1 / 9271.98, 8)

    expect(level38.get('rocky')?.expectedDrops).toBeCloseTo(1 / 256_261, 15)
    expect(level85.get('rocky')?.expectedDrops).toBeCloseTo(1 / 254_736, 15)
  })

  it('doubles seed quantities with rogue equipment without duplicating Rocky', () => {
    const plain = expectedValue(
      masterFarmer,
      resolveSimContext(masterFarmer, { rogueOutfit: false })
    )
    const rogue = expectedValue(
      masterFarmer,
      resolveSimContext(masterFarmer, { rogueOutfit: true })
    )
    const rogueByKey = new Map(rogue.items.map((item) => [item.itemKey, item]))

    for (const item of plain.items) {
      const doubled = rogueByKey.get(item.itemKey)
      expect(doubled?.expectedDrops, `${item.itemKey} rate`).toBeCloseTo(item.expectedDrops, 15)
      expect(doubled?.expectedQuantity, `${item.itemKey} quantity`).toBeCloseTo(
        item.expectedQuantity * (item.itemKey === 'rocky' ? 1 : 2),
        15
      )
    }
  })

  it('is a manual, repeatable successful-pickpocket source with Rocky flagged as its pet', () => {
    expect(masterFarmer).toMatchObject({
      name: 'Master Farmer',
      source: 'merged',
      status: 'manual_override',
      repeatable: true,
      contextDefaults: { farmingLevel: 85, thievingLevel: 38 },
      attemptLabel: {
        singular: 'successful pickpocket',
        plural: 'successful pickpockets',
      },
    })
    const rocky = masterFarmer.tables[1]?.entries[0]?.node
    expect(rocky).toMatchObject({ kind: 'item', itemKey: 'rocky', pet: true })
  })
})

describe('pickpocket source registration', () => {
  it('keeps all non-boss entities in rebuilt inventory', async () => {
    const additions = await loadAdditionalSources()
    for (const slug of ['elf-pickpocketing', 'vyre-pickpocketing', 'master-farmer']) {
      const addition = additions.find(({ source }) => source.id === slug)
      expect(addition?.source).toMatchObject({ include: true, repeatable: true })
      expect(addition?.boss).toMatchObject({ classification: 'own-table', repeatable: true })
    }
  })
})
