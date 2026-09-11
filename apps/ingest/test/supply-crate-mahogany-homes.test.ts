import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, itemMilestones, resolveSimContext, simulate } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'
import { loadAdditionalSources } from '../src/inventory/additional-sources.js'

const slug = 'supply-crate-mahogany-homes'
const boss = BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses', `${slug}.json`), 'utf8')))
const ctx = resolveSimContext(boss, {})

// Wiki revision 15189848: exact stack weights and separate average-loot figures.
const rewards = [
  ['bolt-of-cloth', [[9, 5], [10, 1]], 55],
  ['limestone-brick', [[9, 5], [10, 1]], 55],
  ['mahogany-plank', [[6, 15], [7, 3]], 111],
  ['oak-plank', [[28, 10], [29, 15], [30, 5]], 865],
  ['soft-clay', [[45, 5], [46, 10], [47, 10], [48, 5]], 1395],
  ['steel-bar', [[23, 5], [24, 20], [25, 5]], 720],
  ['teak-plank', [[15, 20], [16, 4]], 364],
] as const

describe('Mahogany Homes supply crates', () => {
  it('preserves every published stack outcome and its weight', () => {
    expect(boss.tables).toHaveLength(1)
    const table = boss.tables[0]!
    expect(table.mode).toBe('weighted')
    expect(table.rolls).toBe(1)
    expect(table.denominator).toBe(144)
    expect(table.entries).toHaveLength(18)
    for (const [key, stacks] of rewards) {
      for (const [qty, weight] of stacks) {
        expect(table.entries).toContainEqual(expect.objectContaining({
          node: expect.objectContaining({ kind: 'item', itemKey: key, noted: true, qty: { kind: 'exact', n: qty } }),
          rate: { kind: 'weight', weight },
        }))
      }
    }
  })

  it('matches the wiki average quantities and per-crate item probabilities', () => {
    const ev = expectedValue(boss, ctx)
    expect(ev.items).toHaveLength(7)
    for (const [key, stacks, quantityNumerator] of rewards) {
      const probability = stacks.reduce((sum, stack) => sum + stack[1], 0) / 144
      const item = ev.items.find((entry) => entry.itemKey === key)!
      expect(item.expectedQuantity).toBeCloseTo(quantityNumerator / 144, 12)
      expect(item.expectedDrops).toBeCloseTo(probability, 12)
      const milestones = itemMilestones(boss, ctx, key)
      expect(milestones.classification).toEqual({ kind: 'exact' })
      expect(milestones.constantPerKillProbability).toBeCloseTo(probability, 12)
    }
  })

  it('opens exactly one valid stack per crate', () => {
    const result = simulate(boss, 10_000, ctx, 42, { logLimit: 10_000 })
    expect(result.log).toHaveLength(10_000)
    for (const roll of result.log) {
      expect(roll.drops).toHaveLength(1)
      const drop = roll.drops[0]!
      const reward = rewards.find(([key]) => key === drop.itemKey)
      expect(reward?.[1].some(([qty]) => qty === drop.qty)).toBe(true)
    }
  })

  it('is verified and registered as a repeatable reward entity', async () => {
    expect(boss.status).toBe('verified')
    expect(boss.validation.checks.filter((check) => check.check !== 'ev_matches').every((check) => check.ok)).toBe(true)
    const addition = (await loadAdditionalSources()).find(({ source }) => source.id === slug)
    expect(addition?.source.include).toBe(true)
    expect(addition?.source.repeatable).toBe(true)
  })
})
