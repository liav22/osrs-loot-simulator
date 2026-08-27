import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  expectedDrawsWithoutReplacement,
  expectedValue,
  itemMilestones,
  killsForTarget,
  MILESTONE_TARGETS,
  resolveSimContext,
  simulate,
  TableSchema,
  type Boss,
  type OwnershipGate,
  type SimContext,
  type Table,
} from '../src/index'
import { ctxWith, makeBoss } from './helpers'

function item(itemId: number, itemKey: string, name = itemKey) {
  return { kind: 'item', itemId, itemKey, name, qty: { kind: 'exact', n: 1 } } as const
}

const REPO_ROOT = join(__dirname, '..', '..', '..')

function loadRealBoss(slug: string): Boss {
  return BossSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'bosses', `${slug}.json`), 'utf8')))
}

function loadSharedTables(): Map<string, Table> {
  const dir = join(REPO_ROOT, 'data', 'tables')
  const shared = new Map<string, Table>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const table = TableSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    shared.set(table.id, table)
  }
  return shared
}

describe('killsForTarget', () => {
  it('matches the closed form by hand', () => {
    // 1/100 per kill, 50% cumulative: ceil(ln(0.5)/ln(0.99)).
    expect(killsForTarget(0.01, 0.5)).toBe(Math.ceil(Math.log(0.5) / Math.log(0.99)))
  })

  it('returns Infinity for a zero probability', () => {
    expect(killsForTarget(0, 0.5)).toBe(Infinity)
  })

  it('returns 1 for a certain drop', () => {
    expect(killsForTarget(1, 0.999)).toBe(1)
  })
})

describe('itemMilestones: simple preroll pet', () => {
  const boss = makeBoss([
    { id: 'pet', mode: 'preroll', entries: [{ node: item(1, 'pet'), rate: { kind: 'fixed', num: 1, den: 100 } }] },
  ])
  const ctx = ctxWith()

  it('classifies exact with the preroll rate as the constant per-kill probability', () => {
    const result = itemMilestones(boss, ctx, 'pet')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBeCloseTo(0.01, 12)
  })

  it('tabulates every milestone via the closed form', () => {
    const result = itemMilestones(boss, ctx, 'pet')
    expect(result.milestones).toEqual(MILESTONE_TARGETS.map((target) => ({ target, kills: killsForTarget(0.01, target) })))
  })

  it('agrees with a windowed Monte Carlo simulation at the 50% milestone', () => {
    const n = killsForTarget(0.01, 0.5)
    const windows = 4000
    const result = simulate(boss, n * windows, ctx, 21, { logLimit: n * windows })
    const hitsPerKill = new Array<boolean>(n * windows).fill(false)
    for (const entry of result.log) {
      if (entry.drops.length > 0) hitsPerKill[entry.kill - 1] = true
    }
    let windowsWithHit = 0
    for (let w = 0; w < windows; w++) {
      let hit = false
      for (let k = w * n; k < (w + 1) * n; k++) if (hitsPerKill[k]) hit = true
      if (hit) windowsWithHit++
    }
    expect(result.log.length).toBe(n * windows) // guard: log wasn't truncated below DEFAULT_LOG_LIMIT
    expect(windowsWithHit / windows).toBeGreaterThan(0.47)
    expect(windowsWithHit / windows).toBeLessThan(0.53)
  })
})

describe('itemMilestones: withoutReplacement item', () => {
  const boss = makeBoss([
    {
      id: 't',
      mode: 'weighted',
      rolls: 2,
      withoutReplacement: true,
      denominator: 4,
      entries: [
        { node: item(1, 'a'), rate: { kind: 'weight', weight: 1 } },
        { node: item(2, 'b'), rate: { kind: 'weight', weight: 1 } },
        { node: item(3, 'c'), rate: { kind: 'weight', weight: 1 } },
        { node: item(4, 'd'), rate: { kind: 'weight', weight: 1 } },
      ],
    },
  ])
  const ctx = ctxWith()

  it('matches expectedDrawsWithoutReplacement directly', () => {
    const weights = new Float64Array([1, 1, 1, 1])
    const expected = expectedDrawsWithoutReplacement(weights, 4, 2)
    const result = itemMilestones(boss, ctx, 'a')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBeCloseTo(expected[0]!, 12)
  })
})

describe('itemMilestones: Ancient-Chest-style multi-roll item', () => {
  // Three independent "rolls" each capable of hitting the SAME target item
  // among distractors — the shape cox:unique-rolls actually has (the same
  // itemKey reachable from more than one entry of one independent table).
  const target = item(1, 'unique')
  const distractorA = item(2, 'distractor-a')
  const distractorB = item(3, 'distractor-b')
  const boss = makeBoss([
    {
      id: 'rolls',
      mode: 'independent',
      entries: [
        {
          node: { kind: 'oneOf', entries: [
            { node: target, rate: { kind: 'weight', weight: 1 } },
            { node: distractorA, rate: { kind: 'weight', weight: 9 } },
          ] },
          rate: { kind: 'fixed', num: 1, den: 2 },
        },
        {
          node: { kind: 'oneOf', entries: [
            { node: target, rate: { kind: 'weight', weight: 1 } },
            { node: distractorB, rate: { kind: 'weight', weight: 9 } },
          ] },
          rate: { kind: 'fixed', num: 1, den: 2 },
        },
      ],
    },
  ])
  const ctx = ctxWith()

  it('composes the two rolls as a true union, not a sum', () => {
    const pPerRoll = 0.5 * 0.1 // roll fires (1/2) AND the oneOf picks the unique (1/10)
    const handComputed = 1 - (1 - pPerRoll) * (1 - pPerRoll)
    const result = itemMilestones(boss, ctx, 'unique')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBeCloseTo(handComputed, 12)
  })

  it('is strictly less than expectedDrops, proving this is not just re-reading the (wrong) expectation', () => {
    const ev = expectedValue(boss, ctx)
    const expectedDrops = ev.items.find((i) => i.itemKey === 'unique')?.expectedDrops ?? 0
    const result = itemMilestones(boss, ctx, 'unique')
    // expectedDrops sums both rolls' contributions linearly (2 * 0.05 = 0.1);
    // the true P(>=1) is 1-(1-0.05)^2 = 0.0975, strictly smaller.
    expect(expectedDrops).toBeCloseTo(0.1, 12)
    expect(result.constantPerKillProbability!).toBeLessThan(expectedDrops)
    expect(result.constantPerKillProbability!).toBeCloseTo(0.0975, 12)
  })

  it('agrees with a windowed Monte Carlo simulation', () => {
    const result = itemMilestones(boss, ctx, 'unique')
    const n = killsForTarget(result.constantPerKillProbability!, 0.5)
    const windows = 4000
    const sim = simulate(boss, n * windows, ctx, 31, { logLimit: n * windows })
    const hitsPerKill = new Array<boolean>(n * windows).fill(false)
    for (const entry of sim.log) {
      if (entry.drops.some((d) => d.itemId === 1)) hitsPerKill[entry.kill - 1] = true
    }
    let windowsWithHit = 0
    for (let w = 0; w < windows; w++) {
      for (let k = w * n; k < (w + 1) * n; k++) {
        if (hitsPerKill[k]) {
          windowsWithHit++
          break
        }
      }
    }
    expect(windowsWithHit / windows).toBeGreaterThan(0.47)
    expect(windowsWithHit / windows).toBeLessThan(0.53)
  })

  describe('regression: against the real corpus', () => {
    it('twisted-bow (reachable from 6 independent rolls of one table) classifies exact with sane-ballpark milestones', () => {
      const boss = loadRealBoss('ancient-chest')
      const sharedTables = loadSharedTables()
      const ctx = resolveSimContext(boss, {})
      const result = itemMilestones(boss, ctx, 'twisted-bow', { tables: sharedTables })
      expect(result.classification).toEqual({ kind: 'exact' })
      const milestones = result.milestones!
      // Loose bounds, not a numeric pin — the exact math is covered by the
      // synthetic cases above. This just proves the real document classifies
      // and computes without throwing, at a plausible order of magnitude.
      expect(milestones[0]!.kills).toBeGreaterThan(100)
      expect(milestones[milestones.length - 1]!.kills).toBeGreaterThan(milestones[0]!.kills)
    })
  })
})

describe('itemMilestones: ToA bad-luck-mitigation item (kill-count ramp)', () => {
  const num = 1
  const den = 10
  const boss = makeBoss([
    {
      id: 'toa:tertiary',
      mode: 'independent',
      entries: [
        {
          node: item(1, 'thread-of-elidinis'),
          rate: { kind: 'formula', id: 'toa_bad_luck_mitigation', params: { num, den } },
          ownershipGate: { itemKey: 'thread-of-elidinis', n: 1, when: 'below' },
        },
        {
          node: item(1, 'thread-of-elidinis'),
          rate: { kind: 'fixed', num: 1, den: 50 },
          ownershipGate: { itemKey: 'thread-of-elidinis', n: 1, when: 'atLeast' },
        },
      ],
    },
  ])

  /** Re-derives the mitigation curve directly from its own stated rule (formulas.ts), independent of anything under test. */
  function rateAt(killCount: number): number {
    const multiplier = Math.min(3, 1 + (2 * killCount) / (1.5 * den))
    return Math.min(1, (num / den) * multiplier)
  }

  it('classifies exact but varying (no single constant probability)', () => {
    const result = itemMilestones(boss, ctxWith(), 'thread-of-elidinis')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBeUndefined()
    expect(result.milestones).toBeDefined()
  })

  it('ignores whatever killCount is already in the page context — the sweep always starts fresh', () => {
    const a = itemMilestones(boss, ctxWith({ killCount: 0 }), 'thread-of-elidinis')
    const b = itemMilestones(boss, ctxWith({ killCount: 9999 }), 'thread-of-elidinis')
    expect(a.milestones).toEqual(b.milestones)
  })

  it('every milestone kill count is independently reproducible from the formula\'s own rule', () => {
    const result = itemMilestones(boss, ctxWith(), 'thread-of-elidinis')
    for (const row of result.milestones!) {
      expect(Number.isFinite(row.kills)).toBe(true)
      let survival = 1
      for (let k = 0; k < row.kills; k++) survival *= 1 - rateAt(k)
      expect(1 - survival).toBeGreaterThanOrEqual(row.target - 1e-9)

      let survivalOneShort = 1
      for (let k = 0; k < row.kills - 1; k++) survivalOneShort *= 1 - rateAt(k)
      expect(1 - survivalOneShort).toBeLessThan(row.target)
    }
  })

  // Monte Carlo cannot cross-check this case: `simulate()` never mutates
  // `ctx.killCount` mid-run (confirmed by inspection of simulate.ts), so a
  // continuous simulated run would sample a single frozen rate for its
  // entire length rather than the fresh-per-window ramp this function
  // models. This is an accepted gap in cross-validation coverage for this
  // one case, not an oversight.
})

describe('itemMilestones: ownership-gated items (out of scope)', () => {
  it('Lunar-Chest-style weighted pool: any sibling gate disqualifies, even the queried item\'s own', () => {
    const boss = makeBoss([
      {
        id: 'set',
        mode: 'weighted',
        denominator: 4,
        entries: [1, 2, 3, 4].map((n) => ({
          node: item(n, `piece-${n}`),
          rate: { kind: 'weight' as const, weight: 1 },
          ownershipGate: { itemKey: `piece-${n}`, n: 1, when: 'below' as const } as OwnershipGate,
        })),
      },
    ])
    const result = itemMilestones(boss, ctxWith(), 'piece-2')
    expect(result.classification).toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    expect(result.milestones).toBeUndefined()
  })

  it('ToA-jewel-style nested oneOf (each jewel self-gated) disqualifies via the recursive walk', () => {
    const boss = makeBoss([
      {
        id: 'toa:tertiary',
        mode: 'independent',
        entries: [
          {
            node: {
              kind: 'oneOf',
              entries: ['eye', 'jewel-of-the-sun', 'breach', 'jewel-of-amascut'].map((key) => ({
                node: item(key.length, key),
                rate: { kind: 'weight' as const, weight: 1 },
                ownershipGate: { itemKey: key, n: 1, when: 'below' as const } as OwnershipGate,
              })),
            },
            rate: { kind: 'fixed', num: 4, den: 50 },
          },
        ],
      },
    ])
    const result = itemMilestones(boss, ctxWith(), 'eye')
    expect(result.classification).toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
  })

  it('positive control: a lone self-gate alongside ungated siblings in the same weighted table is NOT disqualified', () => {
    const boss = makeBoss([
      {
        id: 'pool',
        mode: 'weighted',
        denominator: 10,
        entries: [
          { node: item(1, 'target'), rate: { kind: 'weight', weight: 1 }, ownershipGate: { itemKey: 'target', n: 1, when: 'below' } },
          { node: item(2, 'ordinary'), rate: { kind: 'weight', weight: 9 } },
        ],
      },
    ])
    const result = itemMilestones(boss, ctxWith(), 'target')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBeCloseTo(0.1, 12)
  })

  it('unknown itemKey classifies item-not-found rather than throwing', () => {
    const boss = makeBoss([{ id: 't', mode: 'always', entries: [{ node: item(1, 'a'), rate: { kind: 'always' } }] }])
    const result = itemMilestones(boss, ctxWith(), 'does-not-exist')
    expect(result.classification).toEqual({ kind: 'unsupported', reason: 'item-not-found' })
  })
})

describe('itemMilestones: item reachable from more than one top-level table', () => {
  // Zulrah's own shape: `zulrah-s-scales` is guaranteed by an `always` table
  // AND separately drawable from the main `weighted` table. This is the
  // single most common multi-table shape in the real corpus (a base
  // currency/material topped up by the main table) — not a rare edge case,
  // so it must compute exactly, not get refused.
  const boss = makeBoss([
    { id: 'always', mode: 'always', entries: [{ node: item(1, 'scales'), rate: { kind: 'always' } }] },
    {
      id: 'main',
      mode: 'weighted',
      denominator: 10,
      entries: [
        { node: item(1, 'scales'), rate: { kind: 'weight', weight: 3 } },
        { node: item(2, 'other'), rate: { kind: 'weight', weight: 7 } },
      ],
    },
  ])

  it('an item guaranteed by an always-table is 100% regardless of any other table', () => {
    const result = itemMilestones(boss, ctxWith(), 'scales')
    expect(result.classification).toEqual({ kind: 'exact' })
    expect(result.constantPerKillProbability).toBe(1)
    expect(result.milestones).toEqual(MILESTONE_TARGETS.map((target) => ({ target, kills: 1 })))
  })

  it('unions across tables rather than summing, once neither table alone guarantees it', () => {
    // Two independent 40% chances (not always-guaranteed) must union, not sum.
    const boss = makeBoss([
      {
        id: 'a',
        mode: 'weighted',
        denominator: 10,
        entries: [
          { node: item(1, 'x'), rate: { kind: 'weight', weight: 4 } },
          { node: item(9, 'filler-a'), rate: { kind: 'weight', weight: 6 } },
        ],
      },
      {
        id: 'b',
        mode: 'weighted',
        denominator: 10,
        entries: [
          { node: item(1, 'x'), rate: { kind: 'weight', weight: 4 } },
          { node: item(9, 'filler-b'), rate: { kind: 'weight', weight: 6 } },
        ],
      },
    ])
    const result = itemMilestones(boss, ctxWith(), 'x')
    expect(result.constantPerKillProbability).toBeCloseTo(1 - 0.6 * 0.6, 12)

    const ev = expectedValue(boss, ctxWith())
    const expectedDrops = ev.items.find((i) => i.itemKey === 'x')?.expectedDrops ?? 0
    expect(expectedDrops).toBeCloseTo(0.8, 12) // 0.4 + 0.4, the wrong-for-this-purpose sum
    expect(result.constantPerKillProbability!).toBeLessThan(expectedDrops)
  })

  it('a preroll table hitting a shared item ends the chain before a later weighted table can also contribute it', () => {
    // Hand-verified: preroll item-only at 1/4 (den 4 chosen to divide evenly), then the SAME item
    // also sits in a later weighted table at rate 1/2. P = 0.25 + 0.75*0.5 = 0.625.
    const boss = makeBoss([
      { id: 'pre', mode: 'preroll', entries: [{ node: item(1, 'shared'), rate: { kind: 'fixed', num: 1, den: 4 } }] },
      {
        id: 'main',
        mode: 'weighted',
        denominator: 2,
        entries: [{ node: item(1, 'shared'), rate: { kind: 'weight', weight: 1 } }],
      },
    ])
    const result = itemMilestones(boss, ctxWith(), 'shared')
    expect(result.constantPerKillProbability).toBeCloseTo(0.25 + 0.75 * 0.5, 12)
  })

  describe('regression: against the real corpus', () => {
    it('Zulrah\'s scales (always + weighted) computes exact, matching its guaranteed-drop reality', () => {
      const boss = loadRealBoss('zulrah')
      const sharedTables = loadSharedTables()
      const ctx = resolveSimContext(boss, {})
      const result = itemMilestones(boss, ctx, 'zulrah-s-scales', { tables: sharedTables })
      expect(result.classification).toEqual({ kind: 'exact' })
      expect(result.constantPerKillProbability).toBe(1)
    })
  })
})

describe('regression: every item in the real corpus classifies without throwing', () => {
  it('data/bosses/*.json — every item resolves to exact or a named unsupported reason', () => {
    const sharedTables = loadSharedTables()
    const dir = join(REPO_ROOT, 'data', 'bosses')
    const slugs = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))

    expect(slugs.length).toBeGreaterThan(0)

    for (const slug of slugs) {
      let boss: Boss
      let ctx: SimContext
      try {
        boss = loadRealBoss(slug)
        ctx = resolveSimContext(boss, {})
      } catch {
        continue // parse/resolve failures are covered by apps/ingest's own suite, not this one
      }
      for (const itemKey of boss.tables.flatMap(collectItemKeys)) {
        expect(() => itemMilestones(boss, ctx, itemKey, { tables: sharedTables }), `${slug}: ${itemKey}`).not.toThrow()
      }
    }
  })
})

function collectItemKeys(table: Table): string[] {
  const keys: string[] = []
  const visit = (node: Table['entries'][number]['node']): void => {
    if (node.kind === 'item') keys.push(node.itemKey)
    else if (node.kind === 'oneOf') node.entries.forEach((entry) => visit(entry.node))
  }
  table.entries.forEach((entry) => visit(entry.node))
  return keys
}
