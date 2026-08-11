import { describe, expect, it } from 'vitest'
import {
  createFormulaRegistry,
  defaultFormulaRegistry,
  evaluateFormula,
  FORMULA_IDS,
  FormulaNotImplementedError,
  rateToProbability,
  UnknownFormulaError,
  type FormulaId,
} from '../src/index'
import { ctxWith } from './helpers'

const ctx = ctxWith()

describe('formula registry', () => {
  it('registers exactly the ids section 4.6 lists', () => {
    expect([...defaultFormulaRegistry.keys()].sort()).toEqual([...FORMULA_IDS].sort())
  })

  it('throws rather than returning a silent zero for an unimplemented formula', () => {
    for (const id of FORMULA_IDS) {
      expect(() => evaluateFormula(id, {}, ctx)).toThrow(FormulaNotImplementedError)
    }
  })

  it('uses an override when one is supplied', () => {
    const registry = createFormulaRegistry({ cox_points: () => 0.25 })
    expect(evaluateFormula('cox_points', {}, ctx, registry)).toBe(0.25)
    expect(() => evaluateFormula('tob_points', {}, ctx, registry)).toThrow(
      FormulaNotImplementedError
    )
  })

  it('passes params and context through', () => {
    const registry = createFormulaRegistry({
      toa_invocation: (params, context) => {
        expect(params).toEqual({ raidLevel: 300 })
        expect(context.members).toBe(true)
        return 0.5
      },
    })
    expect(evaluateFormula('toa_invocation', { raidLevel: 300 }, ctx, registry)).toBe(0.5)
  })

  it('rejects a formula result outside [0, 1]', () => {
    const registry = createFormulaRegistry({ barrows_kc: () => 1.5 })
    expect(() => evaluateFormula('barrows_kc', {}, ctx, registry)).toThrow(RangeError)
  })

  it('rejects an id that is not registered at all', () => {
    const empty = new Map()
    expect(() => evaluateFormula('cox_points' as FormulaId, {}, ctx, empty)).toThrow(
      UnknownFormulaError
    )
  })
})

describe('rateToProbability', () => {
  it('converts always and fixed rates', () => {
    expect(rateToProbability({ kind: 'always' }, ctx)).toBe(1)
    expect(rateToProbability({ kind: 'fixed', num: 1, den: 128 }, ctx)).toBeCloseTo(1 / 128, 12)
  })

  it('defers formula rates to the registry', () => {
    const registry = createFormulaRegistry({ wintertodt_points: () => 0.1 })
    expect(
      rateToProbability({ kind: 'formula', id: 'wintertodt_points', params: {} }, ctx, registry)
    ).toBe(0.1)
  })

  it('refuses to give a weight rate a standalone probability', () => {
    expect(() => rateToProbability({ kind: 'weight', weight: 5 }, ctx)).toThrow(TypeError)
  })
})
