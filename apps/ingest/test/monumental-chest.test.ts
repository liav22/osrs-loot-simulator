import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  defaultFormulaRegistry,
  expectedValue,
  simulate,
  withDerivedContext,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Theatre of Blood (`data/overrides/monumental-chest.json`).
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures, not merely that the mechanic be
 * modelled — `docs/OVERRIDES.md` step 3. This file is that check, run against
 * the REAL generated document so it fails if a future re-parse stops emitting
 * any of it.
 *
 * Every assertion is pinned to something cited in `docs/bosses/monumental-chest.md`:
 *
 *   "there is a 1/9.1 (~11%) chance of a unique reward"      — Monumental chest, ===Pre-roll===
 *   Hard Mode: "1/7.7 (~13%)"                                — ===Pre-roll===, ====Hard mode====
 *   Avernic defender hilt 8/19 (Normal) vs 7/18 (Hard)        — ===Pre-roll=== weight tables
 *   "Only obtained if a player ends the raid with 0
 *    individual contribution points"                         — Cabbage/Message DropsLineReward citation
 *   playerpoints = max(0,(6-iskip)*3 + imvp - ideath*4),
 *   maxpoints = 18*teammates+14 (teammates=1: 32)             — Module:Theatre of Blood calculator
 *   qmult: 1 (Normal) / 1.15 (Hard) / 1.30 (Hard, time
 *    bonus — FLAT total, not 1.15 squared)                    — Module:Theatre of Blood calculator
 *   Death rune 500-600, Runite ore 60-72, Grimy torstol
 *    20-24, Yew seed 3, Rune battleaxe 4                      — Monumental chest ===Common rewards===
 *   "The elite clue scroll rarity for Entry, Normal, and
 *    Hard Mode is 1/25, 3/25, and 3.5/25, respectively"       — ===Tertiary rewards=== citation
 *   Holy/Sanguine ornament kit, Sanguine dust all share one
 *    {{refn|name=hardmode}} reading "Only obtainable in
 *    Hard Mode"                                                — ===Tertiary rewards=== citation
 *   "The base rate for Lil' Zik is 1/650 in Normal Mode
 *    and 1/500 in Hard Mode"                                   — ===Tertiary rewards=== citation
 *
 * NOT asserted, because the override declines to model them: team/party
 * allocation, the "individual performance" scaling on tertiary rates, and
 * Entry Mode's own points/death interaction (if any).
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', 'monumental-chest.json'), 'utf8'))
  return BossSchema.parse(raw)
}

function ctxWith(overrides: Partial<SimContext>): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, members: true, ...overrides }
}

const UNIQUES = [
  'avernic-defender-hilt',
  'ghrazi-rapier',
  'sanguinesti-staff-uncharged',
  'justiciar-faceguard',
  'justiciar-chestguard',
  'justiciar-legguards',
  'scythe-of-vitur-uncharged',
]

/** Sum of expected per-raid drops across the whole 7-item unique pool — the total unique chance. */
function uniqueChance(boss: Boss, ctx: SimContext): number {
  const ev = expectedValue(boss, ctx)
  return UNIQUES.reduce((sum, key) => sum + (ev.items.find((d) => d.itemKey === key)?.expectedDrops ?? 0), 0)
}

function rateOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const ev = expectedValue(boss, ctx)
  return ev.items.find((d) => d.itemKey === itemKey)?.expectedDrops ?? 0
}

describe('ToB: the unique pre-roll reproduces the wiki’s stated rates at full points', () => {
  it('is exactly 1/9.1 in Normal Mode', async () => {
    const boss = await loadBoss()
    expect(uniqueChance(boss, ctxWith({ variant: 'normal' }))).toBeCloseTo(1 / 9.1, 9)
  })

  it('is exactly 1/7.7 in Hard Mode, whether or not the time bonus applies', async () => {
    const boss = await loadBoss()
    expect(uniqueChance(boss, ctxWith({ variant: 'hard' }))).toBeCloseTo(1 / 7.7, 9)
    expect(uniqueChance(boss, ctxWith({ variant: 'hard-fast' }))).toBeCloseTo(1 / 7.7, 9)
  })

  it('is 0 in Entry Mode — no unique pre-roll exists at all', async () => {
    const boss = await loadBoss()
    expect(uniqueChance(boss, ctxWith({ variant: 'entry' }))).toBe(0)
  })

  it('splits Normal Mode’s roll 8/19 to the hilt vs 1/19 to the scythe', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'normal' })
    const hilt = rateOf(boss, ctx, 'avernic-defender-hilt')
    const scythe = rateOf(boss, ctx, 'scythe-of-vitur-uncharged')
    expect(hilt / scythe).toBeCloseTo(8, 9)
  })

  it('reweights the hilt to 7/18 in Hard Mode, leaving the rest unchanged', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith({ variant: 'hard' })
    const hilt = rateOf(boss, ctx, 'avernic-defender-hilt')
    const scythe = rateOf(boss, ctx, 'scythe-of-vitur-uncharged')
    expect(hilt / scythe).toBeCloseTo(7, 9)
  })
})

describe('ToB: deaths and skipped rooms reduce the unique chance proportionally', () => {
  it('costs 4 of 32 points per death, straight off the Normal Mode rate', async () => {
    const boss = await loadBoss()
    const oneDeath = uniqueChance(boss, ctxWith({ variant: 'normal', deaths: 1 }))
    expect(oneDeath).toBeCloseTo((28 / 32 / 9.1), 9)
  })

  it('costs 3 of 32 points per room skipped', async () => {
    const boss = await loadBoss()
    const allSkipped = uniqueChance(boss, ctxWith({ variant: 'normal', roomsSkipped: 6 }))
    // 6 rooms skipped: 0 room points + 14 MVP points = 14/32.
    expect(allSkipped).toBeCloseTo((14 / 32 / 9.1), 9)
  })

  it('floors at 0 points, never going negative, from either penalty alone or combined', async () => {
    const boss = await loadBoss()
    expect(uniqueChance(boss, ctxWith({ variant: 'normal', deaths: 8 }))).toBe(0)
    expect(uniqueChance(boss, ctxWith({ variant: 'normal', roomsSkipped: 6, deaths: 4 }))).toBe(0)
    // Even more deaths than the max ever costs must not throw or go negative.
    expect(uniqueChance(boss, ctxWith({ variant: 'normal', deaths: 50 }))).toBe(0)
  })
})

describe('ToB: zero points give only Cabbage and Message', () => {
  it('awards exactly Cabbage and Message, deterministically, and nothing from the unique or common tables', async () => {
    const boss = await loadBoss()
    const zero = ctxWith({ variant: 'normal', deaths: 8 })
    const sim = simulate(boss, 500, zero, 17)
    expect(sim.drops.find((d) => d.itemKey === 'cabbage')?.drops).toBe(500)
    expect(sim.drops.find((d) => d.itemKey === 'message-theatre-of-blood')?.drops).toBe(500)
    for (const key of [...UNIQUES, 'death-rune', 'vial-of-blood']) {
      expect(sim.drops.find((d) => d.itemKey === key)?.drops ?? 0, key).toBe(0)
    }
  })

  it('never awards Cabbage or Message at nonzero points', async () => {
    const boss = await loadBoss()
    const sim = simulate(boss, 2000, ctxWith({ variant: 'normal' }), 19)
    expect(sim.drops.find((d) => d.itemKey === 'cabbage')?.drops ?? 0).toBe(0)
    expect(sim.drops.find((d) => d.itemKey === 'message-theatre-of-blood')?.drops ?? 0).toBe(0)
  })
})

describe('ToB: common-table quantity scaling', () => {
  /** `tob_common_qty` at full points (ratio 1), directly — no sampling needed for an exact multiplier. */
  const multiplierAt = (variant: string): number =>
    defaultFormulaRegistry.get('tob_common_qty')!({}, withDerivedContext(ctxWith({ variant })))

  it('is 1 in Normal Mode, 1.15 in Hard Mode, and a flat 1.30 with the Hard Mode time bonus', () => {
    expect(multiplierAt('normal')).toBe(1)
    expect(multiplierAt('hard')).toBeCloseTo(1.15, 9)
    expect(multiplierAt('hard-fast')).toBeCloseTo(1.3, 9)
    // The wrong (compounding) reading would be 1.15 squared.
    expect(multiplierAt('hard-fast')).not.toBeCloseTo(1.15 * 1.15, 6)
  })

  it('is a flat -80% in Entry Mode, unscaled by points (the calculator has no Entry option)', () => {
    expect(multiplierAt('entry')).toBeCloseTo(0.2, 9)
    // Deaths/skips do not move it — there is nothing to confirm they apply in Entry Mode at all.
    const entryDeaths = defaultFormulaRegistry.get('tob_common_qty')!(
      {},
      withDerivedContext(ctxWith({ variant: 'entry', deaths: 5 }))
    )
    expect(entryDeaths).toBeCloseTo(0.2, 9)
  })

  it('scales down proportionally with points outside Entry Mode', () => {
    const halfPoints = defaultFormulaRegistry.get('tob_common_qty')!(
      {},
      withDerivedContext(ctxWith({ variant: 'normal', roomsSkipped: 6, deaths: 3 })) // tobPoints = 14-12=2, ratio=2/32
    )
    expect(halfPoints).toBeCloseTo(2 / 32, 9)
  })

  it('reproduces the wiki’s own published ranges at full points, item by item', async () => {
    // At ratio 1 / Normal Mode the multiplier is exactly 1, so the RAW authored
    // quantity (never resampled — `applyQtyMultiplier`'s multiplier===1 fast
    // path is a no-op) is exactly what the wiki page's own DropsLineReward rows
    // state, checked directly against the live page in the override's own note.
    const boss = await loadBoss()
    const table = boss.tables.find((t) => t.id === 'tob:common')!
    const qtyOf = (itemKey: string) => table.entries.find((e) => e.node.kind === 'item' && e.node.itemKey === itemKey)!.node
    expect(qtyOf('death-rune')).toMatchObject({ qty: { kind: 'range', min: 500, max: 600 } })
    expect(qtyOf('runite-ore')).toMatchObject({ qty: { kind: 'range', min: 60, max: 72 } })
    expect(qtyOf('grimy-torstol')).toMatchObject({ qty: { kind: 'range', min: 20, max: 24 } })
    // Two items whose range collapses to a single value — matching the page's
    // own rendering of a bare "3"/"4" rather than a min-max span.
    expect(qtyOf('yew-seed')).toMatchObject({ qty: { kind: 'exact', n: 3 } })
    expect(qtyOf('rune-battleaxe')).toMatchObject({ qty: { kind: 'exact', n: 4 } })
  })

  it('uses the module’s Vial of blood minimum (50), not the page’s stated 45', async () => {
    // Recorded in the override's own note: every other item's range matches
    // the module exactly at ratio 1 (including two collapsed-range cases
    // above), and the page was re-fetched fresh mid-session with an unrelated
    // edit landing in between — ruling out simple staleness — while this one
    // value stayed unchanged. The module's number was used.
    const boss = await loadBoss()
    const table = boss.tables.find((t) => t.id === 'tob:common')!
    const entry = table.entries.find((e) => e.node.kind === 'item' && e.node.itemKey === 'vial-of-blood')!
    expect(entry.node.kind === 'item' && entry.node.qty).toEqual({ kind: 'range', min: 50, max: 60 })
  })
})

describe('ToB: tertiary rewards', () => {
  it('gives the elite clue the page’s own per-mode split: Entry 1/25, Normal 3/25, Hard 3.5/25', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ variant: 'entry' }), 'clue-scroll-elite')).toBeCloseTo(1 / 25, 9)
    expect(rateOf(boss, ctxWith({ variant: 'normal' }), 'clue-scroll-elite')).toBeCloseTo(3 / 25, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard' }), 'clue-scroll-elite')).toBeCloseTo(3.5 / 25, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard-fast' }), 'clue-scroll-elite')).toBeCloseTo(3.5 / 25, 9)
  })

  it('restricts Holy ornament kit, Sanguine ornament kit and Sanguine dust to Hard Mode only', async () => {
    const boss = await loadBoss()
    for (const key of ['holy-ornament-kit', 'sanguine-ornament-kit', 'sanguine-dust']) {
      expect(rateOf(boss, ctxWith({ variant: 'entry' }), key), key).toBe(0)
      expect(rateOf(boss, ctxWith({ variant: 'normal' }), key), key).toBe(0)
      expect(rateOf(boss, ctxWith({ variant: 'hard' }), key), key).toBeGreaterThan(0)
      expect(rateOf(boss, ctxWith({ variant: 'hard-fast' }), key), key).toBeGreaterThan(0)
    }
    expect(rateOf(boss, ctxWith({ variant: 'hard' }), 'holy-ornament-kit')).toBeCloseTo(1 / 100, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard' }), 'sanguine-ornament-kit')).toBeCloseTo(1 / 150, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard' }), 'sanguine-dust')).toBeCloseTo(1 / 275, 9)
  })

  it('runs Lil’ Zik at 1/650 outside Hard Mode and 1/500 inside it', async () => {
    const boss = await loadBoss()
    expect(rateOf(boss, ctxWith({ variant: 'normal' }), 'lil-zik')).toBeCloseTo(1 / 650, 9)
    expect(rateOf(boss, ctxWith({ variant: 'entry' }), 'lil-zik')).toBeCloseTo(1 / 650, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard' }), 'lil-zik')).toBeCloseTo(1 / 500, 9)
    expect(rateOf(boss, ctxWith({ variant: 'hard-fast' }), 'lil-zik')).toBeCloseTo(1 / 500, 9)
  })

  it('still rolls tertiary rewards even at zero points', async () => {
    // The tertiary table carries no tobPoints gate — only the unique preroll
    // and common table are suppressed by a raid ending at 0 points.
    const boss = await loadBoss()
    const sim = simulate(boss, 30_000, ctxWith({ variant: 'normal', deaths: 8 }), 31)
    expect(sim.drops.find((d) => d.itemKey === 'clue-scroll-elite')?.drops ?? 0).toBeGreaterThan(0)
  })
})

describe('ToB: the document still carries what the override authored', () => {
  /**
   * A guard that this suite did non-trivial work, per docs/HANDOFF.md landmine
   * #11f: every assertion above reads the real generated document, so if a
   * re-parse dropped the override the `rateOf`/`simulate` lookups would
   * quietly return 0 or fall through to the stale generated tables and
   * several tests would still pass by coincidence.
   */
  it('is merged from the override with all four hand-authored tables', async () => {
    const boss = await loadBoss()
    expect(boss.source).toBe('merged')
    expect(boss.tables.map((t) => t.id)).toEqual([
      'tob:zero-points-consolation',
      'tob:unique-preroll',
      'tob:common',
      'tob:tertiary',
    ])
    expect(boss.variants).toEqual(['normal', 'hard', 'hard-fast', 'entry'])
  })

  it('still fails not_on_watchlist — the point-scaled mechanic stays watchlisted', async () => {
    const boss = await loadBoss()
    expect(boss.status).toBe('needs_review')
    const watchlist = boss.validation.checks.find((c) => c.check === 'not_on_watchlist')!
    expect(watchlist.ok).toBe(false)
  })

  it('reaches every wiki drop row', async () => {
    const boss = await loadBoss()
    const covered = boss.validation.checks.find((c) => c.check === 'drops_covered')!
    expect(covered.ok).toBe(true)
    expect(covered.detail).toContain('all 43 wiki drop row(s) reachable')
  })
})
