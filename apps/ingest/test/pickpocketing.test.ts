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

describe('pickpocket source registration', () => {
  it('keeps both non-boss entities in rebuilt inventory', async () => {
    const additions = await loadAdditionalSources()
    for (const slug of ['elf-pickpocketing', 'vyre-pickpocketing']) {
      const addition = additions.find(({ source }) => source.id === slug)
      expect(addition?.source).toMatchObject({ include: true, repeatable: true })
      expect(addition?.boss).toMatchObject({ classification: 'own-table', repeatable: true })
    }
  })
})
