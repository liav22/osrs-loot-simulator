import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, SharedTableSchema, expectedValue, itemMilestones, resolveSimContext, simulate } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

const boss = BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses/araxxor.json'), 'utf8')))
const tables = new Map(readdirSync(join(REPO_ROOT, 'data/tables')).filter((file) => file.endsWith('.json')).map((file) => {
  const table = SharedTableSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables', file), 'utf8')))
  return [table.id, table] as const
}))
const pieces = ['noxious-pommel', 'noxious-point', 'noxious-blade']

// Independent oracle: Araxxor revision 15290082, Unique prose and Halberd footnote.
describe('Araxxor halberd sets', () => {
  it.each([[0, 0, 0], [1, 0, 0], [1, 1, 0], [5, 5, 5], [6, 6, 5]])(
    'preserves the combined 1/200 rate with entering counts %j', (...counts) => {
      const ownedCounts = Object.fromEntries(pieces.map((key, i) => [key, counts[i]!]))
      const result = expectedValue(boss, resolveSimContext(boss, { ownedCounts }), { tables })
      const rates = new Map(result.items.map((item) => [item.itemKey, item.expectedDrops]))
      const minimum = Math.min(...counts)
      const missing = counts.filter((count) => count === minimum).length
      for (const [i, key] of pieces.entries()) {
        expect(rates.get(key) ?? 0).toBeCloseTo(counts[i] === minimum ? 1 / 200 / missing : 0, 12)
      }
      expect(pieces.reduce((sum, key) => sum + (rates.get(key) ?? 0), 0)).toBeCloseTo(1 / 200, 12)
      expect(rates.get('araxyte-fang')).toBeCloseTo(1 / 600, 12)
    },
  )

  it.each([7, 53, 2026])('completes every set before any duplicate over 10,000 kills (seed %i)', (seed) => {
    for (const initial of [0, 1]) {
      const counts: Record<string, number> = { 'noxious-pommel': initial, 'noxious-point': 0, 'noxious-blade': 0 }
      const ctx = resolveSimContext(boss, { ownedCounts: { ...counts } })
      const options = { tables, logLimit: 10_000 }
      const result = simulate(boss, 10_000, ctx, seed, options)
      let total = 0
      for (const roll of result.log) {
        const uniques = roll.drops.filter((drop) => pieces.includes(drop.itemKey) || drop.itemKey === 'araxyte-fang')
        expect(uniques.length).toBeLessThanOrEqual(1)
        for (const drop of uniques.filter((drop) => pieces.includes(drop.itemKey))) {
          expect(drop.qty).toBe(1)
          expect(counts[drop.itemKey]).toBe(Math.min(...Object.values(counts)))
          counts[drop.itemKey]!++
          total++
        }
      }
      expect(total).toBeGreaterThan(20)
      expect(total).toBeLessThan(85) // 50 expected; catches the former 150-piece rate.
      expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1)
      for (const key of pieces) {
        expect(result.drops.find((drop) => drop.itemKey === key)?.quantity).toBe(counts[key]! - (key === 'noxious-pommel' ? initial : 0))
      }
      expect(simulate(boss, 10_000, ctx, seed, options)).toEqual(result)
    }
  })

  it('keeps evolving component milestones unsupported and passes deterministic validation', () => {
    for (const key of pieces) {
      expect(itemMilestones(boss, resolveSimContext(boss, {}), key, 1, { tables }).classification)
        .toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    }
    expect(boss.status).toBe('manual_override')
    expect(boss.validation.checks.filter((check) => check.check !== 'ev_matches').every((check) => check.ok)).toBe(true)
  })
})
