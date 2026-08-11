import { describe, expect, it } from 'vitest'
import { BossSchema, TableSchema, type Boss, type BossInput, type Table } from '@osrs-loot-simulator/loot-model'
import { checkRefsResolve } from '../src/validate/refs-resolve.js'

function item(name: string) {
  return { kind: 'item' as const, itemId: 1, itemKey: name, name, qty: { kind: 'exact' as const, n: 1 } }
}

function boss(tables: BossInput['tables']): Boss {
  return BossSchema.parse({
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    tables,
    status: 'needs_review',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: false, checks: [] },
  })
}

describe('checkRefsResolve', () => {
  it('passes trivially when the boss has no tableRef nodes at all', () => {
    const result = checkRefsResolve(
      boss([{ id: 't', mode: 'always', entries: [{ node: item('a'), rate: { kind: 'always' } }] }]),
      new Map()
    )
    expect(result).toEqual({ check: 'refs_resolve', ok: true, detail: 'no tableRef nodes' })
  })

  it('resolves a tableRef against the supplied shared tables', () => {
    const shared: Table = TableSchema.parse({
      id: 'rare_drop_table',
      mode: 'weighted',
      denominator: 2,
      entries: [{ node: item('dragon spear'), rate: { kind: 'weight', weight: 1 } }],
    })
    const result = checkRefsResolve(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: { kind: 'tableRef', ref: 'rare_drop_table' }, rate: { kind: 'fixed', num: 1, den: 100 } }],
        },
      ]),
      new Map([['rare_drop_table', shared]])
    )
    expect(result.ok).toBe(true)
    expect(result.detail).toMatch(/resolved against 1 shared table/)
  })

  it('fails with a specific message when a tableRef cannot be resolved', () => {
    const result = checkRefsResolve(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: { kind: 'tableRef', ref: 'missing' }, rate: { kind: 'fixed', num: 1, den: 100 } }],
        },
      ]),
      new Map()
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/missing/)
  })

  it('fails with a specific message when the shared tables form a cycle', () => {
    const a: Table = TableSchema.parse({
      id: 'a',
      mode: 'weighted',
      denominator: 1,
      entries: [{ node: { kind: 'tableRef', ref: 'b' }, rate: { kind: 'weight', weight: 1 } }],
    })
    const b: Table = TableSchema.parse({
      id: 'b',
      mode: 'weighted',
      denominator: 1,
      entries: [{ node: { kind: 'tableRef', ref: 'a' }, rate: { kind: 'weight', weight: 1 } }],
    })
    const result = checkRefsResolve(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: { kind: 'tableRef', ref: 'a' }, rate: { kind: 'fixed', num: 1, den: 100 } }],
        },
      ]),
      new Map([
        ['a', a],
        ['b', b],
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/Circular tableRef/)
  })
})
