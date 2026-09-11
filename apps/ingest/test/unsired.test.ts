import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, itemMilestones, resolveSimContext, simulate } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'
import { AdditionalSourcesSchema, appendAdditionalSources, loadAdditionalSources } from '../src/inventory/additional-sources.js'
import type { BossEntry, LootSource } from '../src/inventory/schema.js'

const boss = BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses/unsired.json'), 'utf8')))
const pieces = ['bludgeon-claw', 'bludgeon-spine', 'bludgeon-axon']

// Independent oracle: Unsired Rewards, wiki revision 15328493, weights out of 128/123.
describe('Unsired offerings', () => {
  it.each([0, 1])('matches every reward rate with pet ownership %i', (pet) => {
    const ctx = resolveSimContext(boss, { ownedCounts: { 'abyssal-orphan': pet } })
    const result = expectedValue(boss, ctx)
    const rates = new Map(result.items.map((item) => [item.itemKey, item.expectedDrops]))
    const den = pet ? 123 : 128
    for (const key of pieces) expect(rates.get(key)).toBeCloseTo(62 / den / 3, 12)
    for (const [key, weight] of [['abyssal-dagger', 26], ['abyssal-whip', 12], ['jar-of-miasma', 13], ['abyssal-head', 10]] as const) {
      expect(rates.get(key)).toBeCloseTo(weight / den, 12)
    }
    expect(rates.get('abyssal-orphan') ?? 0).toBe(pet ? 0 : 5 / 128)
    expect([...rates.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('offers exactly one reward, removes acquired pets, and repeats complete bludgeon sets', () => {
    const ctx = resolveSimContext(boss, { ownedCounts: { 'bludgeon-claw': 1 } })
    const result = simulate(boss, 10_000, ctx, 53, { logLimit: 10_000 })
    const counts: Record<string, number> = { 'bludgeon-claw': 1, 'bludgeon-spine': 0, 'bludgeon-axon': 0 }
    let pets = 0
    for (const roll of result.log) {
      expect(roll.drops).toHaveLength(1)
      const drop = roll.drops[0]!
      expect(drop.qty).toBe(1)
      if (drop.itemKey === 'abyssal-orphan') pets++
      if (pieces.includes(drop.itemKey)) {
        expect(counts[drop.itemKey]).toBe(Math.min(...Object.values(counts)))
        counts[drop.itemKey]!++
      }
    }
    expect(pets).toBe(1)
    expect(Math.min(...Object.values(counts))).toBeGreaterThan(1_000)
    const owned = simulate(boss, 100_000, resolveSimContext(boss, { ownedCounts: { 'abyssal-orphan': 1 } }), 9)
    expect(owned.drops.find((drop) => drop.itemKey === 'abyssal-orphan')?.drops ?? 0).toBe(0)
    expect((owned.drops.find((drop) => drop.itemKey === 'abyssal-dagger')?.drops ?? 0) / 100_000)
      .toBeCloseTo(26 / 123, 2)
  })

  it('keeps pet-first probabilities exact and evolving other rewards explicitly unsupported', () => {
    const ctx = resolveSimContext(boss, {})
    const pet = itemMilestones(boss, ctx, 'abyssal-orphan')
    expect(pet.classification).toEqual({ kind: 'exact' })
    expect(pet.constantPerKillProbability).toBe(5 / 128)
    for (const key of ['bludgeon-claw', 'abyssal-dagger']) {
      expect(itemMilestones(boss, ctx, key).classification).toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    }
  })

  it('passes all deterministic validations and remains in rebuilt inventory', async () => {
    expect(boss.status).toBe('manual_override')
    expect(boss.validation.checks.filter((check) => check.check !== 'ev_matches').every((check) => check.ok)).toBe(true)
    const additions = await loadAdditionalSources()
    const bosses: BossEntry[] = []
    const sources = new Map<string, LootSource>()
    appendAdditionalSources(bosses, sources, additions)
    expect(sources.get('unsired')?.repeatable).toBe(true)
    expect(bosses.find((entry) => entry.slug === 'unsired')?.lootSourceId).toBe('unsired')
    expect(() => appendAdditionalSources(bosses, sources, additions)).toThrow('conflicts')
    expect(AdditionalSourcesSchema.safeParse([...additions, ...additions]).success).toBe(false)
  })
})
