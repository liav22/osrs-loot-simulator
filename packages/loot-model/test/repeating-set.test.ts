import { describe, expect, it } from 'vitest'
import { compileBoss, expectedValue, itemMilestones, OwnershipGateSchema, simulate } from '../src/index'
import { ctxWith, makeBoss } from './helpers'

const keys = ['a', 'b', 'c']
const gate = { itemKey: 'a', n: 1, when: 'below' as const, resetPerSet: keys }
const entries = keys.map((itemKey, i) => ({
  node: { kind: 'item' as const, itemId: i + 1, itemKey, name: itemKey, qty: { kind: 'exact' as const, n: 1 } },
  rate: { kind: 'weight' as const, weight: 1 },
  ownershipGate: { ...gate, itemKey },
}))
const boss = makeBoss([{ id: 'pieces', mode: 'weighted', denominator: 3, entries }])

describe('ownership gates reset after complete sets', () => {
  it('completes every set before repeating a piece, including an entering partial set', () => {
    const ctx = ctxWith({ ownedCounts: { a: 1 } })
    const result = simulate(boss, 299, ctx, 7, { logLimit: 299 })
    const counts: Record<string, number> = { a: 1, b: 0, c: 0 }
    for (const roll of result.log) {
      expect(roll.drops).toHaveLength(1)
      const key = roll.drops[0]!.itemKey
      expect(counts[key]).toBe(Math.min(...Object.values(counts)))
      counts[key]!++
    }
    expect(counts).toEqual({ a: 100, b: 100, c: 100 })
    expect(simulate(boss, 299, ctx, 7, { logLimit: 299 })).toEqual(result)
  })

  it('uses the same residual ownership in analytic expectation', () => {
    const result = expectedValue(boss, ctxWith({ ownedCounts: { a: 3, b: 2, c: 2 } }))
    const quantities = Object.fromEntries(result.items.map((item) => [item.itemKey, item.expectedQuantity]))
    expect(quantities.a ?? 0).toBe(0)
    expect(quantities.b).toBe(0.5)
    expect(quantities.c).toBe(0.5)
  })

  it('tracks peer keys even without gates on the peers and rejects a false exact classification', () => {
    for (const mode of ['weighted', 'independent'] as const) {
      const single = makeBoss([{ id: 'single', mode, ...(mode === 'weighted' ? { denominator: 1 } : {}),
        entries: [{ ...entries[0]!, rate: mode === 'weighted' ? { kind: 'weight', weight: 1 } : { kind: 'always' } }] }])
      expect([...compileBoss(single, ctxWith()).trackedItemKeys].sort()).toEqual(keys)
      expect(itemMilestones(single, ctxWith(), 'a').classification)
        .toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    }
  })

  it('requires a distinct set containing the gated item', () => {
    expect(OwnershipGateSchema.safeParse({ ...gate, resetPerSet: ['b', 'c'] }).success).toBe(false)
    expect(OwnershipGateSchema.safeParse({ ...gate, resetPerSet: ['a', 'a'] }).success).toBe(false)
  })
})
