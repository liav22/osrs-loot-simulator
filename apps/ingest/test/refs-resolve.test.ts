import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  TableSchema,
  type Boss,
  type BossInput,
  type Condition,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { checkRefsResolve } from '../src/validate/refs-resolve.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'

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

  it('fails when a tableRef is nested inside a oneOf', () => {
    // Mutates `node.kind`, the field that used to decide the check's scope:
    // the old short-circuit only inspected `entry.node.kind` at the top level,
    // so this document reported "no tableRef nodes". `LeafNodeSchema` admits
    // `tableRef`, so this is a legal document, not a contrived one.
    const result = checkRefsResolve(
      boss([
        {
          id: 't',
          mode: 'weighted',
          denominator: 2,
          entries: [
            {
              node: {
                kind: 'oneOf',
                entries: [
                  { node: item('a'), rate: { kind: 'weight', weight: 1 } },
                  { node: { kind: 'tableRef', ref: 'missing' }, rate: { kind: 'weight', weight: 1 } },
                ],
              },
              rate: { kind: 'weight', weight: 2 },
            },
          ],
        },
      ]),
      new Map()
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/missing/)
  })

  it('fails when a SHARED table references a record that is not present', () => {
    // Transitive resolution: `rare_drop_table` resolves, but what it points at
    // does not. The old check only compiled the reachable graph from the boss
    // and would surface this only if the default context happened to reach it.
    const outer: Table = TableSchema.parse({
      id: 'rare_drop_table',
      mode: 'weighted',
      denominator: 2,
      entries: [{ node: { kind: 'tableRef', ref: 'gem_drop_table' }, rate: { kind: 'weight', weight: 1 } }],
    })
    const result = checkRefsResolve(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: { kind: 'tableRef', ref: 'rare_drop_table' }, rate: { kind: 'fixed', num: 1, den: 100 } }],
        },
      ]),
      new Map([['rare_drop_table', outer]])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/gem_drop_table/)
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

/**
 * The scope-mutation suite.
 *
 * `refs_resolve`'s scope used to be decided by `SimContext`: it delegated
 * wholly to `compileBoss`, and `compileTable` drops condition-excluded entries
 * before resolving anything they point at. Every test above this block uses an
 * UNCONDITIONAL tableRef, which is precisely why the hole survived them — they
 * mutate the data (add a ref, remove a table, build a cycle) but never the
 * field that decides what the check looks at.
 *
 * These mutate the condition instead, holding the data fixed. This is the same
 * lesson `checkWatchlistConsistency`'s `entry.title` gap taught: a guard whose
 * scope comes from a field is only as strong as the tests that move that field.
 */
describe('checkRefsResolve is not disarmed by the conditions on the referencing entry', () => {
  const missingRef = { kind: 'tableRef' as const, ref: 'lunar_chest_blood_set' }

  function bossWithConditions(conditions: Condition[]): Boss {
    return boss([
      {
        id: 't',
        mode: 'independent',
        entries: [{ node: missingRef, rate: { kind: 'fixed', num: 1, den: 56 }, conditions }],
      },
    ])
  }

  it('an unconditional missing ref fails (the control)', () => {
    expect(checkRefsResolve(bossWithConditions([]), new Map()).ok).toBe(false)
  })

  it.each<[string, Condition]>([
    // Each of these is false under `resolveSimContext(boss, {})`, so each one
    // used to make the check pass vacuously.
    ['includes over an empty moonsKilled', { kind: 'includes', field: 'moonsKilled', values: ['blood'] }],
    ['members-only on a default F2P context', { kind: 'members', value: true }],
    ['a quest nobody has completed', { kind: 'questComplete', quest: 'Legends Quest' }],
    ['a kill-count threshold above the default', { kind: 'levelAtLeast', field: 'killCount', n: 500 }],
    ['a delve level above the default', { kind: 'levelAtLeast', field: 'delveLevel', n: 9 }],
    ['a variant the run is not in', { kind: 'variant', name: 'hard' }],
  ])('a missing ref still fails behind %s', (_label, condition) => {
    const result = checkRefsResolve(bossWithConditions([condition]), new Map())
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/lunar_chest_blood_set/)
  })
})

/**
 * The real-data half. The fixture tests above prove the mechanism; this proves
 * the mechanism was actually load-bearing on the committed corpus, which is
 * what makes it a bug report rather than a hypothetical.
 */
describe('checkRefsResolve against the real corpus', () => {
  function loadBoss(slug: string): Boss {
    return BossSchema.parse(
      JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'data', 'bosses', `${slug}.json`), 'utf8'))
    )
  }

  it('Lunar Chest fails against an empty shared-table map', () => {
    // Before the fix this returned `ok: true, "resolved against 0 shared
    // table(s)"` — all three of its refs are gated on `includes` over
    // `moonsKilled`, which is empty by default, so nothing was ever resolved.
    const result = checkRefsResolve(loadBoss('lunar-chest'), new Map())
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/lunar_chest_(blood|blue|eclipse)_set/)
  })

  it('Lunar Chest passes against the real data/tables/ directory', async () => {
    const result = checkRefsResolve(loadBoss('lunar-chest'), await loadSharedTables())
    expect(result.ok).toBe(true)
    // The count is the observable difference between "resolved" and
    // "nothing was reachable, so nothing failed".
    expect(result.detail).toMatch(/[1-9]\d* tableRef node\(s\) resolved/)
  })
})
