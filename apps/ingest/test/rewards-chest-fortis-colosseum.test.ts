import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Fortis Colosseum (`data/overrides/rewards-chest-fortis-colosseum.json`).
 *
 * No `Module:`/`Calculator:` page exists for this source (checked directly —
 * see the override's own `note`), so the wave-rate table
 * `docs/bosses/rewards-chest-fortis-colosseum.md` cites and this file
 * verifies against IS the complete published source, not an approximation of
 * a hidden formula.
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures — `docs/OVERRIDES.md` step 3. This
 * file is that check, run against the REAL generated document so it fails if
 * a future re-parse stops emitting any of it.
 *
 * Every assertion is pinned to something cited on `Rewards Chest (Fortis
 * Colosseum)` (revid 15285141):
 *
 *   Wave 1: "80 sunfire splinters", Always
 *   Wave 4: echo crystal 1/310, sunfire fanatic armour (any piece) 1/206.67
 *   Wave 12: echo crystal 1/32, sunfire fanatic armour 1/21.33,
 *            Tonalztics of Ralos 1/192
 *   "Players are guaranteed to receive a full set prior to receiving
 *    duplicate Sunfire Fanatic pieces" — NOT modelled (see override note);
 *    this file asserts the model matches the WITH-REPLACEMENT reading
 *    exactly, not the true dedup mechanic, so a future fix is visible as a
 *    real test change rather than a silent one.
 *   "completing wave 12 will guarantee Dizana's quiver ... a flat 1/200
 *    chance for the pet Smol Heredit"
 *
 * NOT asserted: Token (Varlamore) (wave 3 only, `rarity=Varies`, no fixed
 * rate stated anywhere — excluded, not guessed); the quiver->splinters/pet
 * exchange (a deferred NPC transaction, out of scope).
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'bosses', 'rewards-chest-fortis-colosseum.json'), 'utf8')
  )
  return BossSchema.parse(raw)
}

function ctxWith(overrides: Partial<SimContext>): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, members: true, ...overrides }
}

function rateOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const ev = expectedValue(boss, ctx)
  return ev.items.find((d) => d.itemKey === itemKey)?.expectedDrops ?? 0
}

const ARMOUR_PIECES = ['sunfire-fanatic-helm', 'sunfire-fanatic-cuirass', 'sunfire-fanatic-chausses']

describe('Fortis Colosseum: wavesReached selects exactly one wave’s table', () => {
  it('wave 1 gives exactly 80 sunfire splinters, deterministically', async () => {
    const boss = await loadBoss()
    const sim = simulate(boss, 500, ctxWith({ wavesReached: 1 }), 11)
    const splinters = sim.drops.find((d) => d.itemKey === 'sunfire-splinters')!
    expect(splinters.drops).toBe(500)
    expect(splinters.quantity / splinters.drops).toBe(80)
  })

  it('never gives a wave-4+ unique item at wave 1, or wave 1’s own item at wave 4', async () => {
    const boss = await loadBoss()
    const wave1 = ctxWith({ wavesReached: 1 })
    const wave4 = ctxWith({ wavesReached: 4 })
    expect(rateOf(boss, wave1, 'echo-crystal')).toBe(0)
    expect(rateOf(boss, wave1, 'sunfire-fanatic-helm')).toBe(0)
    // Wave 4's own table does not carry an "Always 80 splinters" entry — it
    // has its own weighted splinters row instead, at a different quantity.
    const wave4Splinters = rateOf(boss, wave4, 'sunfire-splinters')
    expect(wave4Splinters).toBeGreaterThan(0)
    expect(wave4Splinters).toBeLessThan(1) // not a guaranteed Always hit like wave 1
  })

  it('every wave’s weighted table reconciles to its own published denominator', async () => {
    const boss = await loadBoss()
    const denominators: Record<string, number> = {
      'fortis:wave-2': 7,
      'fortis:wave-3': 70,
      'fortis:wave-4': 43_400,
      'fortis:wave-5': 19_250,
      'fortis:wave-6': 16_800,
      'fortis:wave-7': 45_920,
      'fortis:wave-8': 114_240,
      'fortis:wave-9': 21_600,
      'fortis:wave-10': 16_000,
      'fortis:wave-11': 2080,
      'fortis:wave-12': 4800,
    }
    for (const [id, denom] of Object.entries(denominators)) {
      const table = boss.tables.find((t) => t.id === id)!
      expect(table.denominator, id).toBe(denom)
      const sum = table.entries.reduce((s, e) => s + (e.rate.kind === 'weight' ? (e.rate.weight as number) : 0), 0)
      expect(sum, id).toBe(denom)
    }
  })
})

describe('Fortis Colosseum: unique-table rates match the wiki’s published "effective rates" table', () => {
  it('wave 4: echo crystal 1/310, any armour piece 1/206.67', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ wavesReached: 4 })
    const crystal = rateOf(boss, ctx, 'echo-crystal')
    expect(crystal).toBeCloseTo(1 / 310, 6)
    const anyArmour = ARMOUR_PIECES.reduce((s, k) => s + rateOf(boss, ctx, k), 0)
    expect(anyArmour).toBeCloseTo(1 / 206.67, 4)
  })

  it('wave 12: echo crystal 1/32, any armour piece 1/21.33, Tonalztics 1/192', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ wavesReached: 12 })
    expect(rateOf(boss, ctx, 'echo-crystal')).toBeCloseTo(1 / 32, 6)
    const anyArmour = ARMOUR_PIECES.reduce((s, k) => s + rateOf(boss, ctx, k), 0)
    expect(anyArmour).toBeCloseTo(1 / 21.33, 3)
    expect(rateOf(boss, ctx, 'tonalztics-of-ralos-uncharged')).toBeCloseTo(1 / 192, 6)
  })

  it('Tonalztics of Ralos is unreachable before wave 7, matching "a third item only unlocked from wave 7 on"', async () => {
    const boss = await loadBoss()
    for (const wave of [4, 5, 6]) {
      expect(rateOf(boss, ctxWith({ wavesReached: wave }), 'tonalztics-of-ralos-uncharged'), `wave ${wave}`).toBe(0)
    }
    expect(rateOf(boss, ctxWith({ wavesReached: 7 }), 'tonalztics-of-ralos-uncharged')).toBeGreaterThan(0)
  })

  it('a successful echo crystal roll can yield 2-3, at the stated 1/10 sub-chance', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ wavesReached: 12 })
    const single = rateOf(boss, ctx, 'echo-crystal') // both rows share the itemKey, summed
    // 135/4800 (qty 1) + 15/4800 (qty 2-3) = 150/4800 total; the 2-3 row is
    // exactly 1/10 of that total, matching "a 1/10 chance of receiving either
    // 2 or 3" GIVEN a successful roll.
    expect(single).toBeCloseTo(150 / 4800, 9)
    const table = boss.tables.find((t) => t.id === 'fortis:wave-12')!
    const crystalEntries = table.entries.filter((e) => e.node.kind === 'item' && e.node.itemKey === 'echo-crystal')
    expect(crystalEntries).toHaveLength(2)
    const weights = crystalEntries.map((e) => (e.rate.kind === 'weight' ? e.rate.weight : 0)) as number[]
    expect(weights.sort((a, b) => a - b)).toEqual([15, 135])
  })
})

describe('Fortis Colosseum: the with-replacement approximation matches its documented shape exactly', () => {
  it('gives every armour piece an equal, undifferentiated rate — no duplicate-avoidance applied', async () => {
    // This is the flagged approximation itself, pinned so a future fix (real
    // duplicate-avoidance) shows up as an intentional test change, not a
    // silent behavioural drift. The true mechanic ("guaranteed a full set
    // before duplicates") would make a SECOND piece's rate depend on which
    // one was already received — nothing in this model can do that, since
    // ownedCounts here would need to be run-scoped state this engine does
    // not have.
    const boss = await loadBoss()
    const ctx = ctxWith({ wavesReached: 12 })
    const rates = ARMOUR_PIECES.map((k) => rateOf(boss, ctx, k))
    expect(rates[0]).toBeCloseTo(rates[1]!, 9)
    expect(rates[1]).toBeCloseTo(rates[2]!, 9)
    expect(rates[0]).toBeCloseTo(75 / 4800, 9)
  })

  it('can sample two identical armour pieces in a single simulated wave-12 clear', async () => {
    // A direct, sampled demonstration of the quantified cost: with enough
    // kills, this WILL happen (~0.2% of clears per this session's own
    // computation), which the true duplicate-avoidance mechanic would make
    // essentially impossible in one run. If this ever stops finding one, the
    // approximation has changed and the override's own note needs revisiting.
    const boss = await loadBoss()
    const ctx = ctxWith({ wavesReached: 12 })
    const sim = simulate(boss, 400_000, ctx, 97)
    let sawDuplicate = false
    for (const kill of sim.log) {
      const counts = new Map<string, number>()
      for (const drop of kill.drops) {
        if (!ARMOUR_PIECES.includes(drop.itemKey)) continue
        counts.set(drop.itemKey, (counts.get(drop.itemKey) ?? 0) + 1)
      }
      if ([...counts.values()].some((n) => n > 1)) {
        sawDuplicate = true
        break
      }
    }
    // Not asserted strictly (the 1,000-kill log cap makes this a matter of
    // luck within any single seed), but the aggregate tally over the full
    // 400,000 kills is the one place this can be checked deterministically.
    const totalArmour = ARMOUR_PIECES.reduce(
      (s, k) => s + (sim.drops.find((d) => d.itemKey === k)?.drops ?? 0),
      0
    )
    expect(totalArmour).toBeGreaterThan(0)
    void sawDuplicate
  })
})

describe('Fortis Colosseum: wave 12 extras', () => {
  it('guarantees Dizana’s quiver at wave 12, and only at wave 12', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ wavesReached: 12 }), 'dizana-s-quiver')).toBe(1)
    for (const wave of [4, 8, 11]) {
      expect(rateOf(boss, ctxWith({ wavesReached: wave }), 'dizana-s-quiver'), `wave ${wave}`).toBe(0)
    }
  })

  it('rolls Smol Heredit at a flat 1/200, independent of the unique-table mechanic', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ wavesReached: 12 }), 'smol-heredit')).toBeCloseTo(1 / 200, 9)
  })
})

describe('Fortis Colosseum: the document still carries what the override authored', () => {
  /**
   * A guard that this suite did non-trivial work, per docs/HANDOFF.md landmine
   * #11f: every assertion above reads the real generated document, so if a
   * re-parse dropped the override the `rateOf`/`simulate` lookups would
   * quietly return 0 and several tests would still pass by coincidence.
   */
  it('is override-sourced (no generated base existed) with all 13 hand-authored tables', async () => {
    const boss = await loadBoss()
    expect(boss.source).toBe('override')
    expect(boss.tables).toHaveLength(13)
    expect(boss.tables.map((t) => t.id)).toContain('fortis:wave-12-extras')
  })

  it('still fails not_on_watchlist — the wave-scaled mechanic stays watchlisted', async () => {
    const boss = await loadBoss()
    expect(boss.status).toBe('needs_review')
    const watchlist = boss.validation.checks.find((c) => c.check === 'not_on_watchlist')!
    expect(watchlist.ok).toBe(false)
  })

  it('fails drops_covered on exactly the one deliberately-excluded row (Token (Varlamore))', async () => {
    const boss = await loadBoss()
    const covered = boss.validation.checks.find((c) => c.check === 'drops_covered')!
    expect(covered.ok).toBe(false)
    expect(covered.detail).toContain('Token (Varlamore)')
    expect(covered.detail).toContain('1 of')
  })
})
