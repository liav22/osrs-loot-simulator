import { describe, expect, it } from 'vitest'
import type { Table } from '@osrs-loot-simulator/loot-model'
import { checkWeightsSum } from '../src/validate/weights-sum.js'

function item(name: string) {
  return { kind: 'item' as const, itemId: 1, itemKey: name, name, qty: { kind: 'exact' as const, n: 1 } }
}

describe('checkWeightsSum', () => {
  it('passes a weighted table with no markers that fits its denominator', () => {
    const table: Table = {
      id: 't',
      mode: 'weighted',
      rolls: 1,
      withoutReplacement: false,
      denominator: 100,
      entries: [
        { node: item('a'), rate: { kind: 'weight', weight: 40 } },
        { node: item('b'), rate: { kind: 'weight', weight: 30 } },
      ],
    }
    const result = checkWeightsSum([table])
    expect(result.ok).toBe(true)
  })

  it('fails a weighted table with no markers that overflows its denominator', () => {
    const table: Table = {
      id: 't',
      mode: 'weighted',
      rolls: 1,
      withoutReplacement: false,
      denominator: 50,
      entries: [
        { node: item('a'), rate: { kind: 'weight', weight: 40 } },
        { node: item('b'), rate: { kind: 'weight', weight: 30 } },
      ],
    }
    const result = checkWeightsSum([table])
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatchObject({ tableId: 't', variant: 'flat', sum: 70 })
  })

  it('passes the Brutus-shaped members/F2P split at denominator 81', () => {
    const table: Table = {
      id: 'brutus:main',
      mode: 'weighted',
      rolls: 1,
      withoutReplacement: false,
      denominator: 81,
      entries: [
        { node: item('shared'), rate: { kind: 'weight', weight: 56 } },
        {
          node: item('members-only'),
          rate: { kind: 'weight', weight: 25 },
          conditions: [{ kind: 'members', value: true }],
        },
        {
          node: item('f2p-only'),
          rate: { kind: 'weight', weight: 25 },
          conditions: [{ kind: 'members', value: false }],
        },
      ],
    }
    const result = checkWeightsSum([table])
    expect(result.ok).toBe(true)
  })

  it('fails when the members variant does not reconcile but F2P does', () => {
    const table: Table = {
      id: 't',
      mode: 'weighted',
      rolls: 1,
      withoutReplacement: false,
      denominator: 81,
      entries: [
        { node: item('shared'), rate: { kind: 'weight', weight: 56 } },
        {
          node: item('members-only'),
          rate: { kind: 'weight', weight: 20 }, // should be 25
          conditions: [{ kind: 'members', value: true }],
        },
        {
          node: item('f2p-only'),
          rate: { kind: 'weight', weight: 25 },
          conditions: [{ kind: 'members', value: false }],
        },
      ],
    }
    const result = checkWeightsSum([table])
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      expect.objectContaining({ variant: 'members', sum: 76, denominator: 81 }),
    ])
  })

  it('ignores non-weighted tables entirely', () => {
    const table: Table = {
      id: 't',
      mode: 'always',
      rolls: 1,
      withoutReplacement: false,
      entries: [{ node: item('a'), rate: { kind: 'always' } }],
    }
    expect(checkWeightsSum([table]).ok).toBe(true)
  })

  it('allows a flat shortfall as the implicit nothing remainder', () => {
    const table: Table = {
      id: 't',
      mode: 'weighted',
      rolls: 1,
      withoutReplacement: false,
      denominator: 128,
      entries: [{ node: item('a'), rate: { kind: 'weight', weight: 78 } }],
    }
    expect(checkWeightsSum([table]).ok).toBe(true)
  })
})
