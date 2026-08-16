import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  INCLUDED_CLASSIFICATIONS,
  InventorySchema,
  type Inventory,
} from '../src/inventory/schema.js'
import { INVENTORY_PATH } from '../src/inventory/build.js'

describe('InventorySchema', () => {
  const base = {
    inventoryVersion: 1,
    generatedAt: '2026-08-11T00:00:00.000Z',
    category: 'Category:Bosses',
    bosses: [
      {
        slug: 'dharok-the-wretched',
        title: 'Dharok the Wretched',
        pageid: 1,
        revid: 2,
        lootSourceId: 'chest-barrows',
        classification: 'reward-page',
        tier: 'E',
        rowCount: 0,
        encounter: 'Barrows',
        repeatable: true,
      },
      {
        slug: 'ahrim-the-blighted',
        title: 'Ahrim the Blighted',
        pageid: 3,
        revid: 4,
        lootSourceId: 'chest-barrows',
        classification: 'reward-page',
        tier: 'E',
        rowCount: 1,
        encounter: 'Barrows',
        repeatable: true,
      },
    ],
    lootSources: [
      {
        id: 'chest-barrows',
        title: 'Barrows',
        dropsPage: 'Chest (Barrows)',
        tier: 'A',
        rowCount: 34,
        include: true,
        excludeReason: null,
        bosses: ['dharok-the-wretched', 'ahrim-the-blighted'],
        repeatable: true,
      },
    ],
  }

  it('accepts a many-to-one mapping', () => {
    const inventory = InventorySchema.parse(base)
    expect(inventory.lootSources[0]?.bosses).toHaveLength(2)
  })

  it('rejects a boss pointing at a loot source that does not exist', () => {
    const broken = {
      ...base,
      bosses: [{ ...base.bosses[0], lootSourceId: 'nowhere' }, base.bosses[1]],
    }
    const result = InventorySchema.safeParse(broken)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toMatch(/unknown lootSourceId/)
  })

  it('rejects a loot source with no bosses', () => {
    expect(
      InventorySchema.safeParse({
        ...base,
        lootSources: [{ ...base.lootSources[0], bosses: [] }],
      }).success
    ).toBe(false)
  })

  it('rejects an unknown classification', () => {
    expect(
      InventorySchema.safeParse({
        ...base,
        bosses: [{ ...base.bosses[0], classification: 'vibes' }, base.bosses[1]],
      }).success
    ).toBe(false)
  })
})

/**
 * Reads the generated `data/_inventory.json` when it exists. It is a build
 * product of `pnpm ingest sources`, so these assertions skip on a clean
 * checkout rather than failing CI.
 */
const present = existsSync(INVENTORY_PATH)

describe.skipIf(!present)('generated data/_inventory.json', () => {
  const inventory: Inventory = InventorySchema.parse(
    JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
  )

  it('maps every boss page to exactly one loot source', () => {
    for (const boss of inventory.bosses) {
      const owners = inventory.lootSources.filter((source) =>
        source.bosses.includes(boss.slug)
      )
      expect(owners, boss.slug).toHaveLength(1)
      expect(owners[0]?.id).toBe(boss.lootSourceId)
    }
  })

  it('collapses pages into fewer loot sources', () => {
    expect(inventory.lootSources.length).toBeLessThan(inventory.bosses.length)
  })

  it('has at least one genuinely many-to-one source', () => {
    const shared = inventory.lootSources.filter((source) => source.bosses.length > 1)
    expect(shared.length).toBeGreaterThan(0)
  })

  it('marks a source included exactly when its pages are an included classification', () => {
    const classificationOf = new Map(
      inventory.bosses.map((boss) => [boss.slug, boss.classification])
    )
    for (const source of inventory.lootSources) {
      const anyIncluded = source.bosses.some((slug) => {
        const classification = classificationOf.get(slug)
        return classification !== undefined && INCLUDED_CLASSIFICATIONS.includes(classification)
      })
      expect(source.include, source.id).toBe(anyIncluded)
    }
  })

  it('gives every excluded source a reason and every included source none', () => {
    for (const source of inventory.lootSources) {
      if (source.include) expect(source.excludeReason, source.id).toBeNull()
      else expect(source.excludeReason, source.id).not.toBeNull()
    }
  })

  it('resolves the Barrows brothers onto one shared chest', () => {
    const barrows = inventory.lootSources.find((source) => source.dropsPage === 'Chest (Barrows)')
    expect(barrows).toBeDefined()
    expect(barrows?.bosses.length).toBeGreaterThan(1)
    expect(barrows?.include).toBe(true)
  })
})
