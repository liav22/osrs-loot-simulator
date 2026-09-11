import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, SharedTableSchema, expectedValue, itemMilestones, resolveSimContext, simulate } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

const boss = BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses/alchemical-hydra.json'), 'utf8')))
const tables = new Map(readdirSync(join(REPO_ROOT, 'data/tables')).filter((file) => file.endsWith('.json')).map((file) => {
  const table = SharedTableSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables', file), 'utf8')))
  return [table.id, table] as const
}))
const pieces = ['hydra-s-eye', 'hydra-s-fang', 'hydra-s-heart']
// Wiki revision 15285801: exact conditional rates in the Unique section's prose.
const ringRate = (1999 / 2000) ** 2 * (999 / 1000) * (511 / 512) ** 2 / 180

describe('Alchemical Hydra ordered ring sets', () => {
  it.each([[0, 0, 0], [1, 0, 0], [1, 1, 0], [5, 5, 5], [6, 5, 5], [6, 6, 5], [0, 1, 0]])(
    'preserves the ring access rate and selects the first missing piece from %j', (...counts) => {
      const ownedCounts = Object.fromEntries(pieces.map((key, i) => [key, counts[i]!]))
      const result = expectedValue(boss, resolveSimContext(boss, { ownedCounts }), { tables })
      const rates = new Map(result.items.map((item) => [item.itemKey, item.expectedDrops]))
      const next = counts.indexOf(Math.min(...counts))
      for (const [i, key] of pieces.entries()) {
        expect(rates.get(key) ?? 0).toBeCloseTo(i === next ? ringRate : 0, 12)
      }
      let remaining = 1
      for (const [key, denominator] of [
        ['dragon-thrownaxe', 2000], ['dragon-knife', 2000], ['hydra-s-claw', 1000],
        ['hydra-tail', 512], ['hydra-leather', 512],
      ] as const) {
        expect(rates.get(key)).toBeCloseTo(remaining / denominator, 12)
        remaining *= 1 - 1 / denominator
      }
      expect(1 / (1 - remaining + ringRate)).toBeCloseTo(87.6, 1)
    },
  )

  it.each([7, 53, 2026])('repeats eye, fang, heart across 10,000 kills (seed %i)', (seed) => {
    for (const entering of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [5, 5, 5]]) {
      const counts = [...entering]
      const ctx = resolveSimContext(boss, { ownedCounts: Object.fromEntries(pieces.map((key, i) => [key, counts[i]!])) })
      const options = { tables, logLimit: 10_000 }
      const result = simulate(boss, 10_000, ctx, seed, options)
      let total = 0
      for (const roll of result.log) {
        const uniqueKeys = [...pieces, 'dragon-thrownaxe', 'dragon-knife', 'hydra-s-claw', 'hydra-tail', 'hydra-leather']
        expect(roll.drops.filter((drop) => uniqueKeys.includes(drop.itemKey)).length).toBeLessThanOrEqual(1)
        const drops = roll.drops.filter((drop) => pieces.includes(drop.itemKey))
        expect(drops.length).toBeLessThanOrEqual(1)
        for (const drop of drops) {
          const next = counts.indexOf(Math.min(...counts))
          expect(drop.itemKey).toBe(pieces[next])
          expect(drop.qty).toBe(1)
          counts[next]!++
          total++
        }
      }
      expect(total).toBeGreaterThan(25)
      expect(total).toBeLessThan(90) // ~55 expected; rejects three separate ring-piece rolls.
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
      for (const [i, key] of pieces.entries()) {
        expect(result.drops.find((drop) => drop.itemKey === key)?.quantity).toBe(counts[i]! - entering[i]!)
      }
      expect(simulate(boss, 10_000, ctx, seed, options)).toEqual(result)
    }
  })

  it('retains honest ownership-dependent milestones and deterministic validation', () => {
    for (const key of pieces) {
      expect(itemMilestones(boss, resolveSimContext(boss, {}), key, 1, { tables }).classification)
        .toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    }
    expect(boss.status).toBe('manual_override')
    expect(boss.validation.checks.filter((check) => check.check !== 'ev_matches').every((check) => check.ok)).toBe(true)
  })
})
