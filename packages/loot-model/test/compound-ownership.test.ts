import { describe, expect, it } from 'vitest'
import { compileBoss, expectedValue, itemMilestones, OwnershipGateSchema, simulate } from '../src/index'
import { ctxWith, makeBoss } from './helpers'

const item = (key: string) => ({ kind: 'item' as const, itemId: 1, itemKey: key, name: key, qty: { kind: 'exact' as const, n: 1 } })
const gate = { itemKey: 'second', n: 1, when: 'below' as const, allOf: [
  { itemKey: 'first', n: 1, when: 'atLeast' as const },
  { itemKey: 'replacement', n: 1, when: 'below' as const },
] }

describe('compound ownership requirements', () => {
  it('tracks every dependency, requires all predicates, and classifies conservatively', () => {
    for (const nested of [false, true]) {
      const entry = { node: item('second'), rate: { kind: 'weight' as const, weight: 1 }, ownershipGate: gate }
      const boss = makeBoss([{ id: 'pool', mode: 'weighted', denominator: 1, entries: [nested
        ? { node: { kind: 'oneOf', entries: [entry] }, rate: { kind: 'weight', weight: 1 } }
        : entry] }])
      expect([...compileBoss(boss, ctxWith()).trackedItemKeys].sort()).toEqual(['first', 'replacement', 'second'])
      for (const [ownedCounts, quantity] of [[{}, 0], [{ first: 1 }, 1], [{ first: 1, replacement: 1 }, 0], [{ first: 1, second: 1 }, 0]] as const) {
        expect(expectedValue(boss, ctxWith({ ownedCounts })).items.find(i => i.itemKey === 'second')?.expectedQuantity ?? 0).toBe(quantity)
      }
      expect(itemMilestones(boss, ctxWith(), 'second').classification).toEqual({ kind: 'unsupported', reason: 'ownership-gated' })
    }
  })

  it('reevaluates prerequisites as rewards arrive and preserves seeded replay', () => {
    const boss = makeBoss([{ id: 'pool', mode: 'weighted', denominator: 2, entries: [
      { node: item('first'), rate: { kind: 'weight', weight: 1 }, ownershipGate: { itemKey: 'first', n: 1, when: 'below' } },
      { node: item('second'), rate: { kind: 'weight', weight: 1 }, ownershipGate: gate },
    ] }])
    const result = simulate(boss, 5, ctxWith(), 42, { logLimit: 5 })
    expect(result.log.map(r => r.drops.map(d => d.itemKey))).toEqual([['first'], ['second'], [], [], []])
    expect(simulate(boss, 5, ctxWith(), 42, { logLimit: 5 })).toEqual(result)
  })

  it('rejects empty or malformed additional requirements', () => {
    expect(OwnershipGateSchema.safeParse({ ...gate, allOf: [] }).success).toBe(false)
    expect(OwnershipGateSchema.safeParse({ ...gate, allOf: [{ itemKey: '', n: -1, when: 'below' }] }).success).toBe(false)
  })
})
