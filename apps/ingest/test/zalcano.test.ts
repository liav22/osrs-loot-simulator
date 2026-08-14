import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  withDerivedContext,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for Zalcano (`data/overrides/zalcano.json`).
 *
 * `data/mechanics-watchlist.json`'s removal policy requires the simulation be
 * checked against the wiki's own figures, not merely that the mechanic be
 * modelled. This file is that check, run against the REAL generated document
 * so it fails if a future re-parse stops emitting any of it.
 *
 * Every assertion below is pinned to a sentence on the page (revid 15287396):
 *
 *   "Players must do at least 5 damage to Zalcano's shield to be eligible for
 *    drops, and 31 combined damage to be eligible for uniques and pet."
 *      — ==Drops==
 *
 *   "1 Shard - Player eligible for a drop / 2 Shards - Player eligible for
 *    uniques/pet / 3 Shards - Player is the MVP"
 *      — ===100%===, citing Mod Husky, 10 March 2020
 *
 *   "Infernal ashes are only dropped for the MVP."   — ===100%===
 *
 *   "The MVP ... will also receive an additional 10% (rounded up) of their
 *    non-unique loot."                               — ==Drops==
 *
 *   "Every Zalcano kill always has a 1/200 chance of rolling the crystal tool
 *    seed table ... which includes a 1/40 chance for uncut onyx."
 *      — ===Tertiary===
 *
 *   "The chance of rolling Smolcano is unaffected by performance."
 *      — ===Tertiary===
 *
 * NOT asserted, because the page does not state them: the curve turning
 * `P_M`/`P_T` into loot, and the Zalcano shard's 1/750-1/1500 contribution
 * interpolation. Both are why `zalcano` stays on the mechanics watchlist —
 * see `data/overrides/zalcano.json`'s note.
 */

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', 'zalcano.json'), 'utf8'))
  return BossSchema.parse(raw)
}

/**
 * Damage is supplied as the page's two raw inputs only. `totalDamage` is never
 * set here on purpose: it is derived, and letting these tests set it would
 * defeat the point of the field.
 */
function ctxWith(
  hitpointsDamage: number,
  shieldDamage: number,
  isMVP = false
): SimContext {
  return withDerivedContext({
    ...DEFAULT_SIM_CONTEXT,
    members: true,
    hitpointsDamage,
    shieldDamage,
    isMVP,
  })
}

const SHARD = 'crystal-shard'
const ASHES = 'infernal-ashes'

/** Analytic expected drops per kill for one item. */
function dropsOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const item = expectedValue(boss, ctx).items.find((i) => i.itemKey === itemKey)
  return item?.expectedDrops ?? 0
}

/** Analytic expected units per kill for one item. */
function quantityOf(boss: Boss, ctx: SimContext, itemKey: string): number {
  const item = expectedValue(boss, ctx).items.find((i) => i.itemKey === itemKey)
  return item?.expectedQuantity ?? 0
}

/** Sampled drop count for one item across a whole run. */
function sampledDrops(result: { drops: { itemKey: string; drops: number }[] }, itemKey: string): number {
  return result.drops.find((d) => d.itemKey === itemKey)?.drops ?? 0
}

describe('Zalcano: the two eligibility gates', () => {
  it('drops nothing at all below 5 shield damage, however much hitpoint damage was dealt', async () => {
    const boss = await loadBoss()
    // 1,000 damage to hitpoints and 4 to the shield: far past the 31 combined
    // threshold, but under the shield gate, which the page makes primary.
    const ctx = ctxWith(1_000, 4)
    const result = simulate(boss, 20_000, ctx, 11)

    expect(result.drops.reduce((total, d) => total + d.drops, 0)).toBe(0)
  })

  it('the combined gate reads hitpoints + shield, not either one alone', async () => {
    const boss = await loadBoss()
    // Neither input reaches 31 by itself; together they are exactly 31, which
    // is the threshold `totalDamage` exists to express.
    const justOver = ctxWith(26, 5)
    const justUnder = ctxWith(25, 5)

    expect(justOver.totalDamage).toBe(31)
    expect(justUnder.totalDamage).toBe(30)
    expect(dropsOf(boss, justOver, 'smolcano')).toBeCloseTo(1 / 2250, 12)
    expect(dropsOf(boss, justUnder, 'smolcano')).toBe(0)
  })

  it('derives totalDamage even when a caller supplies a stale value', async () => {
    const boss = await loadBoss()
    // A hand-built context that never went through `resolveSimContext` and
    // claims a totalDamage its own inputs do not support. `compileBoss`
    // recomputes it, so the gate cannot be bypassed.
    const lying = { ...DEFAULT_SIM_CONTEXT, hitpointsDamage: 10, shieldDamage: 5, totalDamage: 999 }
    expect(dropsOf(boss, lying as SimContext, 'smolcano')).toBe(0)
  })
})

describe("Zalcano: crystal shards are a role tier, not a 1-3 range", () => {
  it('gives exactly 1, 2 and 3 shards for the page’s three roles', async () => {
    const boss = await loadBoss()

    // Drop-eligible only (>= 5 shield, < 31 combined).
    expect(quantityOf(boss, ctxWith(20, 5), SHARD)).toBe(1)
    // Unique/pet-eligible (>= 31 combined), not MVP.
    expect(quantityOf(boss, ctxWith(400, 300), SHARD)).toBe(2)
    // MVP.
    expect(quantityOf(boss, ctxWith(400, 300, true), SHARD)).toBe(3)
  })

  it('never yields the intermediate quantities a 1-3 range roll would', async () => {
    const boss = await loadBoss()
    const n = 5_000
    const ctx = ctxWith(400, 300)
    const result = simulate(boss, n, ctx, 7, { logLimit: n })

    const quantities = new Set(
      result.log.flatMap((kill) => kill.drops.filter((d) => d.itemKey === SHARD).map((d) => d.qty))
    )
    // The drop row says `quantity=1-3`. If that were read as a uniform range,
    // a non-MVP unique-eligible player would see 1, 2 and 3 across 5,000
    // kills. The tier rule says they see 2, every time.
    expect([...quantities]).toEqual([2])
  })
})

describe('Zalcano: infernal ashes are a role, not a rate', () => {
  it('always for the MVP, never for anyone else', async () => {
    const boss = await loadBoss()

    expect(dropsOf(boss, ctxWith(400, 300, true), ASHES)).toBe(1)
    expect(dropsOf(boss, ctxWith(400, 300, false), ASHES)).toBe(0)
  })

  it('holds over a real simulated run, not just analytically', async () => {
    const boss = await loadBoss()
    const n = 3_000

    expect(sampledDrops(simulate(boss, n, ctxWith(400, 300, true), 3), ASHES)).toBe(n)
    expect(sampledDrops(simulate(boss, n, ctxWith(400, 300, false), 3), ASHES)).toBe(0)
  })
})

describe("Zalcano: the MVP's +10%, rounded up", () => {
  it('rounds the 10% delta UP, which the default `round` mode would not', async () => {
    const boss = await loadBoss()
    const n = 40_000

    // Runite ore's parsed range is 3-31. Under `ceilDelta` at m = 1.1 the
    // smallest possible MVP quantity is 3 + ceil(0.3) = 4. Under the default
    // `round` mode it would be round(3 * 1.1) = round(3.3) = 3 — identical to
    // the non-MVP value, i.e. the bonus would silently vanish at small
    // quantities. A 3 appearing here is the signature of the wrong mode.
    const mvp = simulate(boss, n, ctxWith(400, 300, true), 21, { logLimit: n })
    const mvpQtys = mvp.log.flatMap((kill) =>
      kill.drops.filter((d) => d.itemKey === 'runite-ore').map((d) => d.qty)
    )
    expect(mvpQtys.length).toBeGreaterThan(100)
    expect(Math.min(...mvpQtys)).toBe(4)

    const plain = simulate(boss, n, ctxWith(400, 300, false), 21, { logLimit: n })
    const plainQtys = plain.log.flatMap((kill) =>
      kill.drops.filter((d) => d.itemKey === 'runite-ore').map((d) => d.qty)
    )
    expect(Math.min(...plainQtys)).toBe(3)
  })

  it('raises main-table quantity for the MVP and leaves drop RATES untouched', async () => {
    const boss = await loadBoss()
    const mvp = ctxWith(400, 300, true)
    const plain = ctxWith(400, 300, false)

    // Conflating the two would silently inflate every rate the UI reports —
    // the same failure the Abyssal Sire x2 check guards against.
    expect(dropsOf(boss, mvp, 'runite-ore')).toBeCloseTo(dropsOf(boss, plain, 'runite-ore'), 12)
    expect(quantityOf(boss, mvp, 'runite-ore')).toBeGreaterThan(
      quantityOf(boss, plain, 'runite-ore')
    )
  })

  it('does not apply to the crystal shards, which are already role-tiered', async () => {
    const boss = await loadBoss()
    // 3 shards for the MVP, not 3 + ceil(0.3) = 4.
    expect(quantityOf(boss, ctxWith(400, 300, true), SHARD)).toBe(3)
  })
})

describe('Zalcano: the tertiary table reproduces the page’s stated split', () => {
  it('the tool-seed table is 1/200 overall, with a 1/40 onyx share inside it', async () => {
    const boss = await loadBoss()
    const ctx = ctxWith(400, 300)

    const seed = dropsOf(boss, ctx, 'crystal-tool-seed')
    const onyx = dropsOf(boss, ctx, 'uncut-onyx')

    // "a 1/200 chance of rolling the crystal tool seed table ... which
    // includes a 1/40 chance for uncut onyx. If no onyx is dropped, a tool
    // seed will be dropped."
    expect(seed + onyx).toBeCloseTo(1 / 200, 12)
    expect(onyx / (seed + onyx)).toBeCloseTo(1 / 40, 12)
    expect(seed / (seed + onyx)).toBeCloseTo(39 / 40, 12)
  })

  it('Smolcano is flat 1/2,250 and unaffected by performance', async () => {
    const boss = await loadBoss()

    // "The chance of rolling Smolcano is unaffected by performance" — so the
    // barely-eligible player, the maxed-contribution player and the MVP all
    // share one rate. This is the page's own prose agreeing with its 21 May
    // 2020 news citation ("a static 1/2,250 chance"), which is what settles
    // the older Mod Lenny tweet's points-scaled example.
    const barely = dropsOf(boss, ctxWith(26, 5), 'smolcano')
    const maxed = dropsOf(boss, ctxWith(400, 300), 'smolcano')
    const mvp = dropsOf(boss, ctxWith(400, 300, true), 'smolcano')

    expect(barely).toBeCloseTo(1 / 2250, 12)
    expect(maxed).toBeCloseTo(1 / 2250, 12)
    expect(mvp).toBeCloseTo(1 / 2250, 12)
  })
})
