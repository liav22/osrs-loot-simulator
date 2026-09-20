import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  entryApplies,
  evaluateWeight,
  resolveSimContext,
  simulate,
  type Boss,
} from '@osrs-loot-simulator/loot-model'
import { loadAdditionalSources } from '../src/inventory/additional-sources.js'
import { REPO_ROOT } from '../src/snapshots/store.js'

function loadBoss(slug: string): Boss {
  return BossSchema.parse(
    JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses', `${slug}.json`), 'utf8'))
  )
}

const cases = [
  {
    slug: 'brimstone-chest',
    boss: loadBoss('brimstone-chest'),
    uniqueDenominator: 1000,
    uniqueWeights: [5, 1, 1, 1, 1, 1],
    access: { num: 1, den: 100 },
    uniqueKeys: [
      'broken-dragon-hasta',
      'mystic-hat-dusk',
      'mystic-robe-top-dusk',
      'mystic-robe-bottom-dusk',
      'mystic-gloves-dusk',
      'mystic-boots-dusk',
    ],
  },
  {
    slug: 'larran-s-big-chest',
    boss: loadBoss('larran-s-big-chest'),
    uniqueDenominator: 256,
    uniqueWeights: [1, 1, 1],
    access: { num: 3, den: 256 },
    uniqueKeys: ['dagon-hai-hat', 'dagon-hai-robe-top', 'dagon-hai-robe-bottom'],
  },
] as const

describe.each(cases)('$slug', ({ boss, uniqueDenominator, uniqueWeights, uniqueKeys, access }) => {
  it('preserves the unique pool and the complete /60 main roll', () => {
    expect(boss.tables).toHaveLength(2)
    const [unique, main] = boss.tables
    expect(unique).toMatchObject({ mode: 'preroll' })
    expect(unique?.entries).toHaveLength(1)
    expect(unique?.entries[0]?.rate).toEqual({
      kind: 'fixed',
      num: access.num,
      den: access.den,
    })
    expect(unique?.entries[0]?.node).toMatchObject({ kind: 'oneOf' })
    const uniquePool = unique?.entries[0]?.node
    expect(
      uniquePool?.kind === 'oneOf'
        ? uniquePool.entries.map((entry) =>
            entry.rate.kind === 'weight' && typeof entry.rate.weight === 'number'
              ? entry.rate.weight * uniqueDenominator
              : null
          )
        : []
    ).toEqual(uniqueWeights)
    expect(main).toMatchObject({ mode: 'weighted', denominator: 60 })
    const staticWeight = main!.entries.reduce(
      (sum, entry) =>
        sum +
        (entry.rate.kind === 'weight' && typeof entry.rate.weight === 'number'
          ? entry.rate.weight
          : 0),
      0
    )
    expect(staticWeight).toBe(57)
  })

  it.each([1, 17, 33, 99])('fills the remaining 3/60 with fish at level %i', (fishingLevel) => {
    const ctx = resolveSimContext(boss, { fishingLevel })
    const main = boss.tables[1]!
    const fishWeight = main.entries.reduce((sum, entry) => {
      if (!entryApplies(entry, ctx)) return sum
      if (entry.rate.kind !== 'weight' || typeof entry.rate.weight === 'number') return sum
      return sum + evaluateWeight(entry.rate.weight.id, entry.rate.weight.params, ctx)
    }, 0)
    expect(fishWeight).toBeCloseTo(3, 12)
  })

  it('awards exactly one stack per opening and is seed-reproducible', () => {
    const ctx = resolveSimContext(boss, { fishingLevel: 99 })
    const first = simulate(boss, 20_000, ctx, 42, { logLimit: 20_000 })
    const second = simulate(boss, 20_000, ctx, 42, { logLimit: 20_000 })
    expect(second.drops).toEqual(first.drops)
    expect(first.log).toHaveLength(20_000)
    expect(first.log.every((opening) => opening.drops.length === 1)).toBe(true)
  })

  it('is a verified repeatable opening source with curated uniques', () => {
    expect(boss).toMatchObject({
      status: 'verified',
      source: 'generated',
      repeatable: true,
      attemptLabel: { singular: 'opening', plural: 'openings' },
    })
    for (const itemKey of uniqueKeys) {
      const uniquePool = boss.tables[0]!.entries[0]?.node
      const node =
        uniquePool?.kind === 'oneOf'
          ? uniquePool.entries.find(
              (entry) => entry.node.kind === 'item' && entry.node.itemKey === itemKey
            )?.node
          : undefined
      expect(node, itemKey).toMatchObject({ kind: 'item', unique: true })
    }
  })
})

describe('Slayer chest quantity distributions', () => {
  it('keeps Brimstone shark lures even and Larran fish floor-scaled', () => {
    const brimstone = cases[0].boss.tables[1]!
    const larran = cases[1].boss.tables[1]!
    const qty = (bossTable: typeof brimstone, itemKey: string) =>
      bossTable.entries.find(
        (entry) => entry.node.kind === 'item' && entry.node.itemKey === itemKey
      )?.node

    expect(qty(brimstone, 'shark-lure')).toMatchObject({
      kind: 'item',
      qty: { kind: 'scaledRange', min: 80, max: 250, numerator: 2, denominator: 1 },
    })
    expect(qty(larran, 'raw-tuna')).toMatchObject({
      kind: 'item',
      qty: { kind: 'scaledRange', min: 100, max: 350, numerator: 3, denominator: 2 },
    })
    expect(qty(larran, 'shark-lure')).toMatchObject({
      kind: 'item',
      qty: { kind: 'scaledRange', min: 80, max: 250, numerator: 3, denominator: 1 },
    })
  })

  it('registers both chests outside Category:Bosses', async () => {
    const additions = await loadAdditionalSources()
    for (const { slug } of cases) {
      const addition = additions.find(({ source }) => source.id === slug)
      expect(addition?.source).toMatchObject({ include: true, repeatable: true })
      expect(addition?.boss).toMatchObject({ classification: 'own-table', repeatable: true })
    }
  })
})
