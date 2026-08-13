import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  createFormulaRegistry,
  type Boss,
  type BossInput,
  type QtySpec,
} from '@osrs-loot-simulator/loot-model'
import { checkQtySane } from '../src/validate/qty-sane.js'

function item(name: string, qty: QtySpec = { kind: 'exact', n: 1 }) {
  return { kind: 'item' as const, itemId: 1, itemKey: name, name, qty }
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

describe('checkQtySane', () => {
  it('passes trivially when no formula-driven qty/rolls/multiplier is present', () => {
    const result = checkQtySane(
      boss([{ id: 't', mode: 'always', entries: [{ node: item('a'), rate: { kind: 'always' } }] }])
    )
    expect(result).toEqual({
      check: 'qty_sane',
      ok: true,
      detail: 'exact/range/choice quantities are schema-enforced; no formula-driven quantity, rolls, or qtyMultiplier present',
    })
  })

  it('fails on a formula-driven qty with no implementation yet (the default registry stub)', () => {
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'always',
          entries: [
            {
              node: item('a', { kind: 'formula', id: 'zalcano_points', params: {} }),
              rate: { kind: 'always' },
            },
          ],
        },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not implemented/)
  })

  it('fails on a qty formula that returns a negative quantity', () => {
    const badRegistry = createFormulaRegistry({ zalcano_points: () => -1 })
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'always',
          entries: [
            {
              node: item('a', { kind: 'formula', id: 'zalcano_points', params: {} }),
              rate: { kind: 'always' },
            },
          ],
        },
      ]),
      badRegistry
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/non-negative quantity/)
  })

  it('fails on a formula-driven rolls count that errors', () => {
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'weighted',
          denominator: 1,
          rolls: { kind: 'formula', id: 'zalcano_points', params: {} },
          entries: [{ node: item('a'), rate: { kind: 'weight', weight: 1 } }],
        },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not implemented/)
  })

  it('fails on a Table.qtyMultiplier formula that returns a non-positive value', () => {
    const badRegistry = createFormulaRegistry({ zalcano_points: () => 0 })
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'always',
          qtyMultiplier: { kind: 'formula', id: 'zalcano_points', params: {} },
          entries: [{ node: item('a'), rate: { kind: 'always' } }],
        },
      ]),
      badRegistry
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/positive multiplier/)
  })

  it('fails on a TableRefNode.qtyMultiplier formula that errors', () => {
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [
            {
              node: {
                kind: 'tableRef',
                ref: 'rare_drop_table',
                qtyMultiplier: { kind: 'formula', id: 'zalcano_points', params: {} },
              },
              rate: { kind: 'fixed', num: 1, den: 100 },
            },
          ],
        },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not implemented/)
  })

  it('passes and counts every correctly implemented formula value', () => {
    const goodRegistry = createFormulaRegistry({ zalcano_points: () => 3 })
    const result = checkQtySane(
      boss([
        {
          id: 't',
          mode: 'always',
          qtyMultiplier: { kind: 'formula', id: 'zalcano_points', params: {} },
          entries: [
            { node: item('a', { kind: 'formula', id: 'zalcano_points', params: {} }), rate: { kind: 'always' } },
          ],
        },
      ]),
      goodRegistry
    )
    expect(result).toEqual({
      check: 'qty_sane',
      ok: true,
      detail: '2 formula-driven quantity/rolls/multiplier value(s) evaluated successfully',
    })
  })
})
