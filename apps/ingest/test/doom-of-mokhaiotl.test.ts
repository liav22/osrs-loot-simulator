import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  type Boss,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Doom of Mokhaiotl (`data/overrides/doom-of-mokhaiotl.json`).
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures, not merely that the mechanic be
 * modelled. This file is that check, and it is unusually well served: the page
 * states a **worked example** that pins the quantity rule exactly.
 *
 *   "a player is equally likely to receive 2, 3, or 4 dragon platelegs at
 *    delve level 3. Delve level 2 has a -0.35x quantity multiplier, which
 *    gives possible quantities of 2, 2, and 3, respectively, meaning there is
 *    a 2/3 chance to receive two sets and a 1/3 chance to receive three sets."
 *      — Doom of Mokhaiotl, ===Mechanics===, revid 15276851
 *
 * That is a distributional claim, so it is asserted distributionally below
 * rather than on a mean.
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'bosses', 'doom-of-mokhaiotl.json'), 'utf8')
  )
  return BossSchema.parse(raw)
}

const PLATELEGS = 'dragon-platelegs'
const ctxAt = (delveLevel: number) => ({ ...DEFAULT_SIM_CONTEXT, members: true, delveLevel })

/** Only the level-N common table carrying dragon platelegs, isolated. */
function levelTableOnly(boss: Boss, level: number): Boss {
  const id = `doom:L${level}:weapons-and-armour-runes-and-ammunition-ores-seeds`
  const table = boss.tables.find((t) => t.id === id)
  if (table === undefined) throw new Error(`no table ${id}`)
  return BossSchema.parse({ ...boss, tables: [table] })
}

describe("Doom of Mokhaiotl: the wiki's own dragon-platelegs worked example", () => {
  it('delve 3 is the unscaled baseline: 2, 3 and 4 equally likely', async () => {
    const boss = levelTableOnly(await loadBoss(), 3)
    const n = 60_000
    const result = simulate(boss, n, ctxAt(3), 5, { logLimit: n })

    const qtys = result.log.flatMap((k) => k.drops.filter((d) => d.itemKey === PLATELEGS).map((d) => d.qty))
    expect(qtys.length).toBeGreaterThan(300)
    const share = (v: number): number => qtys.filter((q) => q === v).length / qtys.length
    for (const v of [2, 3, 4]) {
      expect(share(v), `qty ${v} at delve 3`).toBeGreaterThan(0.28)
      expect(share(v), `qty ${v} at delve 3`).toBeLessThan(0.39)
    }
    // The page states delve-3 quantities are the document's baseline, so no
    // multiplier is applied at this level at all.
    expect(qtys.every((q) => q >= 2 && q <= 4)).toBe(true)
  })

  it('delve 2 collapses them to 2, 2 and 3 — a 2/3 vs 1/3 split, exactly as stated', async () => {
    const boss = levelTableOnly(await loadBoss(), 2)
    const n = 60_000
    const result = simulate(boss, n, ctxAt(2), 5, { logLimit: n })

    const qtys = result.log.flatMap((k) => k.drops.filter((d) => d.itemKey === PLATELEGS).map((d) => d.qty))
    expect(qtys.length).toBeGreaterThan(300)

    // Only 2 and 3 are reachable — never 4, and never 1.
    expect(new Set(qtys)).toEqual(new Set([2, 3]))
    const twos = qtys.filter((q) => q === 2).length / qtys.length
    expect(twos).toBeGreaterThan(0.60)
    expect(twos).toBeLessThan(0.73)

    // `round` would have given 2, 2, 3 -> no: round(3*0.65)=2, round(4*0.65)=3,
    // round(2*0.65)=1. A 1 appearing here is the signature of the wrong mode.
    expect(qtys.includes(1)).toBe(false)
  })
})

describe('Doom of Mokhaiotl: per-level structure', () => {
  it('every level cleared rolls the common table once, so deeper runs get more loot', async () => {
    const boss = await loadBoss()
    const ev = (level: number): number =>
      expectedValue(boss, ctxAt(level)).items.reduce((s, i) => s + i.expectedDrops, 0)

    // Strictly increasing: reaching level 5 fires levels 1-5's tables, not
    // just level 5's. This is the "per-level bankable loot" claim.
    for (let level = 1; level < 8; level++) {
      expect(ev(level + 1), `delve ${level + 1} vs ${level}`).toBeGreaterThan(ev(level))
    }
  })

  it('uniques respect their minimum delve level and their per-level rates', async () => {
    const boss = await loadBoss()
    const rate = (level: number, key: string): number =>
      expectedValue(boss, ctxAt(level)).items.find((i) => i.itemKey === key)?.expectedDrops ?? 0

    // Avernic treads: nothing below level 4 (its stated minimum).
    expect(rate(3, 'avernic-treads')).toBe(0)
    expect(rate(4, 'avernic-treads')).toBeCloseTo(1 / 1350, 12)
    // Eye of ayak from level 3, cloth from level 2.
    expect(rate(2, 'eye-of-ayak-uncharged')).toBe(0)
    expect(rate(1, 'mokhaiotl-cloth')).toBe(0)
    expect(rate(2, 'mokhaiotl-cloth')).toBeCloseTo(1 / 2500, 12)
    // Dom from level 6 only.
    expect(rate(5, 'dom')).toBe(0)
    expect(rate(6, 'dom')).toBeCloseTo(1 / 1000, 12)

    // Rates accumulate across levels rather than replacing: a level-4 run
    // rolled cloth at level 2's, 3's AND 4's rates.
    expect(rate(4, 'mokhaiotl-cloth')).toBeCloseTo(1 / 2500 + 1 / 2000 + 1 / 1350, 12)
  })

  it('guaranteed demon tears accumulate to the wiki\'s cumulative column', async () => {
    const boss = await loadBoss()
    const tears = (level: number): number =>
      expectedValue(boss, ctxAt(level)).items.find((i) => i.itemKey === 'demon-tear')
        ?.expectedQuantity ?? 0

    // The page's "Cumulative demon tears" column: 0, 0, 50, 60, 70, 80, 90, 100.
    // Those are guaranteed grants; the common table's own demon-tear entry
    // adds a probabilistic amount on top, so assert the guaranteed floor.
    expect(tears(2)).toBeLessThan(50)
    expect(tears(3)).toBeGreaterThanOrEqual(50)
    expect(tears(8)).toBeGreaterThanOrEqual(100)
  })

  it('deep delves repeat the >8 row once per level beyond 8', async () => {
    const boss = await loadBoss()
    const ev = (level: number): number =>
      expectedValue(boss, ctxAt(level)).items.find((i) => i.itemKey === 'mokhaiotl-cloth')
        ?.expectedDrops ?? 0

    // Levels 9..12 all roll the same ">8" row, so each extra deep delve adds
    // exactly one more 1/540 roll — the whole reason the deep-rolls formula
    // exists rather than a constant.
    const atNine = ev(9)
    expect(ev(10)).toBeCloseTo(atNine + 1 / 540, 12)
    expect(ev(12)).toBeCloseTo(atNine + 3 / 540, 12)
  })
})

describe('Doom of Mokhaiotl: document status', () => {
  it('is off the mechanics watchlist and reaches manual_override', async () => {
    const watchlist = JSON.parse(
      await readFile(join(REPO_ROOT, 'data', 'mechanics-watchlist.json'), 'utf8')
    ) as { entries: { lootSourceId: string }[] }
    expect(watchlist.entries.map((e) => e.lootSourceId)).not.toContain('doom-of-mokhaiotl')

    const boss = await loadBoss()
    expect(boss.status).toBe('manual_override')
    expect(boss.source).toBe('merged')
  })
})

describe('Doom of Mokhaiotl: curated unique/pet flags', () => {
  // Regression for the bug fixed alongside this suite: an override's
  // `tables` replace the generated ones wholesale and never pass through
  // `assembleBoss`'s own item-node construction, so `data/item-flags.json`'s
  // curated flags for this boss (avernic-treads, eye-of-ayak-uncharged: unique;
  // dom: pet) were silently never embedded — the UI showed no uniques at
  // all for Doom of Mokhaiotl despite the flags being correctly curated. See
  // `apps/ingest/src/items/item-flags.ts`'s `applyItemFlags`.
  it('every avernic-treads/eye-of-ayak-uncharged node is flagged unique, and every dom node is flagged pet', async () => {
    const boss = await loadBoss()
    const nodes = boss.tables.flatMap((t) => t.entries.map((e) => e.node))

    const treads = nodes.filter((n) => n.kind === 'item' && n.itemKey === 'avernic-treads')
    expect(treads.length).toBeGreaterThan(0)
    expect(treads.every((n) => n.kind === 'item' && n.unique === true)).toBe(true)

    const eyeOfAyak = nodes.filter((n) => n.kind === 'item' && n.itemKey === 'eye-of-ayak-uncharged')
    expect(eyeOfAyak.length).toBeGreaterThan(0)
    expect(eyeOfAyak.every((n) => n.kind === 'item' && n.unique === true)).toBe(true)

    const dom = nodes.filter((n) => n.kind === 'item' && n.itemKey === 'dom')
    expect(dom.length).toBeGreaterThan(0)
    expect(dom.every((n) => n.kind === 'item' && n.pet === true)).toBe(true)
  })

  it("the web app's uniqueItemKeys() sees all three, matching the wiki's own list", async () => {
    // Mirrors apps/web/src/lib/uniques.ts exactly (walks item/oneOf nodes,
    // collecting `unique || pet`), without importing apps/web — packages/
    // loot-model may not import from apps/*, and this file already avoids
    // reaching into apps/web for the same reason its sibling suites do.
    const boss = await loadBoss()
    const keys = new Set<string>()
    for (const table of boss.tables) {
      for (const entry of table.entries) {
        const node = entry.node
        if (node.kind === 'item' && (node.unique || node.pet)) keys.add(node.itemKey)
      }
    }
    expect(keys).toEqual(new Set(['avernic-treads', 'eye-of-ayak-uncharged', 'dom']))
  })
})
