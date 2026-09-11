import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, itemMilestones, resolveSimContext, simulate, type Table } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'
import { loadAdditionalSources } from '../src/inventory/additional-sources.js'

const boss = BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data/bosses/rewards-guardian.json'), 'utf8')))
const pouchKeys = ['small-pouch', 'medium-pouch', 'large-pouch', 'giant-pouch']
const quests = ['Troll Stronghold', "Mourning's End Part II"]
let sharedTables: Map<string, Table>
beforeAll(async () => { sharedTables = await loadSharedTables() })

// Independent figures: Rewards Guardian revision 15338032, exact main and alternate rows.
describe('Guardians of the Rift searches', () => {
  it('matches every main reward rate across all 16 pouch ownership combinations', () => {
    for (let mask = 0; mask < 16; mask++) {
      const ownedCounts = Object.fromEntries(pouchKeys.map((key, i) => [key, (mask >> i) & 1]))
      const ctx = resolveSimContext(boss, { ownedCounts })
      const den = mask === 15 ? 125 : 140
      const items = new Map(expectedValue(boss, ctx, { tables: sharedTables }).items.map(i => [i.itemKey, i]))
      for (const key of ['air', 'water', 'earth', 'fire', 'mind', 'body']) expect(items.get(`${key}-rune`)?.expectedDrops).toBeCloseTo(4 / den, 12)
      for (const key of ['chaos', 'cosmic', 'nature', 'law', 'death', 'blood']) expect(items.get(`${key}-rune`)?.expectedDrops).toBeCloseTo(10 / den, 12)
      for (const [key, weight] of [['abyssal-pearls', 18], ['intricate-pouch', 5], ['abyssal-ashes', 1], ['needle', 1]] as const) expect(items.get(key)?.expectedDrops).toBeCloseTo(weight / den, 12)
      expect(items.get('abyssal-pearls')?.expectedQuantity).toBeCloseTo(270 / den, 12)
      const firstMissing = pouchKeys.findIndex(key => !ownedCounts[key])
      pouchKeys.forEach((key, i) => expect(items.get(key)?.expectedDrops ?? 0).toBeCloseTo(i === firstMissing ? 15 / 140 : 0, 12))
      expect(items.get('pure-essence')?.expectedQuantity ?? 0).toBeCloseTo(firstMissing < 0 ? 0 : 2 * (firstMissing + 1) * 15 / 140, 12)
      for (const [key, weight] of [['air', 3], ['water', 3], ['earth', 3], ['fire', 3], ['mind', 4], ['body', 4], ['chaos', 4], ['cosmic', 4], ['nature', 4], ['elemental', 1], ['law', 1], ['death', 1]] as const) expect(items.get(`${key}-talisman`)?.expectedDrops).toBeCloseTo(16 * weight / (35 * den), 12)
    }
  })

  it('treats a colossal pouch as owning all pouches', () => {
    const ctx = resolveSimContext(boss, { ownedCounts: { 'colossal-pouch': 1 } })
    const ev = expectedValue(boss, ctx, { tables: sharedTables })
    for (const key of pouchKeys) expect(ev.items.find(i => i.itemKey === key)?.expectedDrops ?? 0).toBe(0)
    expect(ev.items.find(i => i.itemKey === 'abyssal-pearls')?.expectedDrops).toBeCloseTo(18 / 125, 12)
  })

  it('replaces quest-locked talismans with air talismans without losing probability mass', () => {
    for (const questsComplete of [[], [quests[0]!], [quests[1]!], quests]) {
      const ev = expectedValue(boss, resolveSimContext(boss, { questsComplete }), { tables: sharedTables })
      const rates = new Map(ev.items.map(i => [i.itemKey, i.expectedDrops]))
      expect(rates.get('air-talisman')).toBeCloseTo(16 * (5 - questsComplete.length) / 4375, 12)
      expect(rates.get('law-talisman') ?? 0).toBeCloseTo(questsComplete.includes(quests[0]!) ? 16 / 4375 : 0, 12)
      expect(rates.get('death-talisman') ?? 0).toBeCloseTo(questsComplete.includes(quests[1]!) ? 16 / 4375 : 0, 12)
    }
  })

  it('preserves rare and pet marginals when one-time rewards have already been received', () => {
    for (const received of [0, 1]) {
      const ctx = resolveSimContext(boss, { ownedCounts: { 'atlax-s-diary': received, 'abyssal-needle': received } })
      const ev = expectedValue(boss, ctx, { tables: sharedTables })
      const rates = new Map(ev.items.map(i => [i.itemKey, i.expectedDrops]))
      for (const [key, den] of [['catalytic-talisman', 200], ['abyssal-lantern', 700], ['abyssal-red-dye', 1200], ['abyssal-green-dye', 1200], ['abyssal-blue-dye', 1200], ['abyssal-protector', 4000]] as const) expect(rates.get(key)).toBeCloseTo(1 / den, 12)
      expect(rates.get('atlax-s-diary') ?? 0).toBeCloseTo(received ? 0 : 1 / 20, 12)
      expect(rates.get('abyssal-needle') ?? 0).toBeCloseTo(received ? 0 : 1 / 300, 12)
    }
    const milestones = itemMilestones(boss, resolveSimContext(boss, {}), 'abyssal-protector', 1, { tables: sharedTables })
    expect(milestones.constantPerKillProbability).toBeCloseTo(1 / 4000, 12)
    expect(milestones.classification).toEqual({ kind: 'exact' })
  })

  it('progresses through pouches, includes their essence, and awards a main reward every search', () => {
    const ctx = resolveSimContext(boss, { ownedCounts: {} })
    const result = simulate(boss, 20_000, ctx, 42, { tables: sharedTables, logLimit: 20_000 })
    const mainKeys = new Set(['pure-essence', ...pouchKeys, 'abyssal-pearls', 'intricate-pouch', 'abyssal-ashes', 'needle', ...['air', 'water', 'earth', 'fire', 'mind', 'body', 'chaos', 'cosmic', 'nature', 'law', 'death', 'blood'].map(k => `${k}-rune`), ...['air', 'water', 'earth', 'fire', 'mind', 'body', 'chaos', 'cosmic', 'nature', 'elemental', 'law', 'death'].map(k => `${k}-talisman`)])
    const seen: string[] = []
    for (const roll of result.log) {
      const main = roll.drops.filter(d => mainKeys.has(d.itemKey))
      const pouch = main.find(d => pouchKeys.includes(d.itemKey))
      if (pouch) {
        expect(pouch.itemKey).toBe(pouchKeys[seen.length])
        seen.push(pouch.itemKey)
        expect(main.find(d => d.itemKey === 'pure-essence')?.qty).toBe(2 * seen.length)
        expect(main).toHaveLength(2)
      } else expect(main).toHaveLength(1)
    }
    expect(seen).toEqual(pouchKeys)
    for (const key of ['atlax-s-diary', 'abyssal-needle']) expect(result.drops.find(d => d.itemKey === key)?.quantity).toBe(1)
    expect(result.log.some(r => r.drops.some(d => d.itemKey === 'abyssal-protector') && r.drops.length >= 2)).toBe(true)
  })

  it('retains explicit caveats, aliases, and repeatable inventory registration', async () => {
    expect(boss.aliases).toEqual(['Guardians of the Rift', 'GotR'])
    expect(boss.status).toBe('needs_review')
    expect(boss.statusTier).toBe('approximate')
    expect(boss.validation.checks.filter(c => c.check !== 'ev_matches' && c.check !== 'not_on_watchlist').every(c => c.ok)).toBe(true)
    expect((await loadAdditionalSources()).find(a => a.source.id === boss.slug)?.source.repeatable).toBe(true)
  })
})
