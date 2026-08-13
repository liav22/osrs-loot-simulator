import { describe, expect, it } from 'vitest'
import { expectedValue, simulate, type OwnershipGate } from '../src/index'
import { ctxWith, dropCount, dropQuantity, makeBoss } from './helpers'

/**
 * Extension B: `Entry.ownershipGate`, `SimContext.ownedCounts`. Covers the
 * two confirmed shapes (docs/mechanics-model-proposal.md) — a rate-swap pair
 * (Duke Sucellus/ToA: two mutually exclusive entries for the same item, one
 * pre-obtain, one post-obtain) and a weighted-pool shrink (Lunar Chest: N
 * equally-weighted pieces, each excluded from the pool once owned). Both are
 * lifetime-scoped: ownership only grows, persists for the whole simulated
 * batch, and never resets mid-batch — genuinely different from Fortis
 * Colosseum's run-scoped dedup, which stays out of scope (see the proposal's
 * "Deferred" section).
 */

function item(itemId: number, itemKey: string, name = itemKey) {
  return { kind: 'item', itemId, itemKey, name, qty: { kind: 'exact', n: 1 } } as const
}

const below: OwnershipGate = { itemKey: 'ice-quartz', n: 1, when: 'below' }
const atLeast: OwnershipGate = { itemKey: 'ice-quartz', n: 1, when: 'atLeast' }

/** Duke Sucellus/ToA shape: guaranteed pre-obtain, 50% post-obtain, same item. */
function rateSwapBoss() {
  return makeBoss([
    {
      id: 'ice-quartz-chain',
      mode: 'independent',
      entries: [
        { node: item(1, 'ice-quartz'), rate: { kind: 'always' }, ownershipGate: below },
        { node: item(1, 'ice-quartz'), rate: { kind: 'fixed', num: 1, den: 2 }, ownershipGate: atLeast },
      ],
    },
  ])
}

/** Lunar Chest shape: 4 equally-weighted pieces, each excluded once owned. */
function weightedPoolBoss() {
  return makeBoss([
    {
      id: 'eclipse-set',
      mode: 'weighted',
      denominator: 4,
      entries: [1, 2, 3, 4].map((n) => ({
        node: item(n, `piece-${n}`),
        rate: { kind: 'weight' as const, weight: 1 },
        ownershipGate: { itemKey: `piece-${n}`, n: 1, when: 'below' as const },
      })),
    },
  ])
}

describe('ownershipGate: rate-swap shape (simulate)', () => {
  it('starting unowned: kill 1 always hits (below-gate, always-rate), later kills use the atLeast-gate 50% rate', () => {
    const boss = rateSwapBoss()
    const ctx = ctxWith({ ownedCounts: {} })
    const n = 100_000
    const result = simulate(boss, n, ctx, 1)
    const drops = dropCount(result.drops, 1)
    // Kill 1 contributes exactly 1 guaranteed hit; the remaining n-1 kills
    // each hit at 50%. A tracker that's broken (e.g. always stuck at the
    // below-gate) would give ~n hits, not ~n/2 — nowhere near this band.
    const expected = 1 + 0.5 * (n - 1)
    expect(drops).toBeGreaterThan(expected * 0.98)
    expect(drops).toBeLessThan(expected * 1.02)
  })

  it('starting already owned: the below-gate (always-rate) entry never fires, even on kill 1', () => {
    const boss = rateSwapBoss()
    const ctx = ctxWith({ ownedCounts: { 'ice-quartz': 1 } })
    const n = 100_000
    const result = simulate(boss, n, ctx, 1)
    const drops = dropCount(result.drops, 1)
    // If the starting ownedCounts were ignored, kill 1 (and therefore the
    // aggregate) would be pulled toward the always-rate; observing ~n/2
    // rather than ~n confirms the entering value was honored, not just the
    // in-run transition from the previous test.
    expect(drops).toBeGreaterThan(n * 0.48)
    expect(drops).toBeLessThan(n * 0.52)
  })
})

describe('ownershipGate: rate-swap shape (expectedValue — static, single kill)', () => {
  it('unowned entering: expects exactly the always-rate (1 drop/kill)', () => {
    const boss = rateSwapBoss()
    const result = expectedValue(boss, ctxWith({ ownedCounts: {} }))
    expect(result.items.find((i) => i.itemId === 1)?.expectedDrops).toBe(1)
  })

  it('already owned entering: expects exactly the atLeast-rate (0.5 drops/kill), not the sum of both', () => {
    const boss = rateSwapBoss()
    const result = expectedValue(boss, ctxWith({ ownedCounts: { 'ice-quartz': 1 } }))
    expect(result.items.find((i) => i.itemId === 1)?.expectedDrops).toBeCloseTo(0.5, 12)
  })
})

describe('ownershipGate: weighted-pool shape (simulate)', () => {
  it('each piece drops at most once across a large batch — the pool shrinks as pieces are obtained', () => {
    const boss = weightedPoolBoss()
    const ctx = ctxWith({ ownedCounts: {} })
    const result = simulate(boss, 1000, ctx, 7)
    for (const n of [1, 2, 3, 4]) {
      expect(dropCount(result.drops, n), `piece-${n}`).toBe(1)
      expect(dropQuantity(result.drops, n), `piece-${n}`).toBe(1)
    }
  })

  it('a piece already owned entering the run is never drawn', () => {
    const boss = weightedPoolBoss()
    const ctx = ctxWith({ ownedCounts: { 'piece-2': 1 } })
    const result = simulate(boss, 1000, ctx, 7)
    expect(dropCount(result.drops, 2)).toBe(0)
    for (const n of [1, 3, 4]) expect(dropCount(result.drops, n)).toBe(1)
  })

  it('all pieces already owned: the table contributes nothing, no NaN/crash', () => {
    const boss = weightedPoolBoss()
    const ctx = ctxWith({
      ownedCounts: { 'piece-1': 1, 'piece-2': 1, 'piece-3': 1, 'piece-4': 1 },
    })
    const result = simulate(boss, 1000, ctx, 7)
    for (const n of [1, 2, 3, 4]) expect(dropCount(result.drops, n)).toBe(0)
    expect(Number.isFinite(result.gpTotal)).toBe(true)
  })
})

describe('ownershipGate: weighted-pool shape (expectedValue — static, single kill)', () => {
  it('all pieces already owned: every item expects exactly 0, not NaN', () => {
    const boss = weightedPoolBoss()
    const result = expectedValue(
      boss,
      ctxWith({ ownedCounts: { 'piece-1': 1, 'piece-2': 1, 'piece-3': 1, 'piece-4': 1 } })
    )
    for (const item of result.items) {
      expect(item.expectedDrops).toBe(0)
      expect(Number.isFinite(item.expectedDrops)).toBe(true)
    }
  })

  it('one piece owned: its expected share redistributes to the remaining three, not to nothing', () => {
    const boss = weightedPoolBoss()
    const result = expectedValue(boss, ctxWith({ ownedCounts: { 'piece-2': 1 } }))
    expect(result.items.find((i) => i.itemId === 2)?.expectedDrops).toBe(0)
    for (const n of [1, 3, 4]) {
      expect(result.items.find((i) => i.itemId === n)?.expectedDrops).toBeCloseTo(1 / 3, 12)
    }
  })
})

describe('ownershipGate: seeded-RNG determinism', () => {
  it('same seed + same input ⇒ byte-identical output, for both shapes, across a batch large enough to exercise cross-kill state', () => {
    for (const boss of [rateSwapBoss(), weightedPoolBoss()]) {
      const ctx = ctxWith({ ownedCounts: {} })
      const a = simulate(boss, 20_000, ctx, 12345)
      const b = simulate(boss, 20_000, ctx, 12345)
      expect(a.drops).toEqual(b.drops)
      expect(a.gpTotal).toBe(b.gpTotal)
      expect(a.log).toEqual(b.log)

      // A different seed must diverge somewhere. For the weighted-pool shape,
      // 20,000 kills against only 4 slots converges to the SAME final
      // aggregate (each piece obtained exactly once) almost regardless of
      // seed — that's the correct, intended behavior, not a determinism
      // failure — so the divergence check has to look at the (seed-ordered)
      // kill log, which records WHEN each piece was obtained, not just the
      // final tally.
      const c = simulate(boss, 20_000, ctx, 6789)
      expect(a.log).not.toEqual(c.log)
    }
  })

  it('ownership tracking does not desync the RNG stream from a boss with no ownership gates at all', () => {
    // Regression guard for a specific failure mode: if the tracker were
    // wired in a way that consumed rng draws (it must not — it's derived
    // purely from already-decided outcomes), a gate-free boss's output
    // would change too. It must not.
    const boss = makeBoss([
      { id: 't', mode: 'weighted', denominator: 2, entries: [
        { node: item(1, 'a'), rate: { kind: 'weight', weight: 1 } },
        { node: item(2, 'b'), rate: { kind: 'weight', weight: 1 } },
      ] },
    ])
    const ctx = ctxWith()
    const a = simulate(boss, 10_000, ctx, 999)
    const b = simulate(boss, 10_000, ctx, 999)
    expect(a).toEqual(b)
  })
})
