import { describe, expect, it } from 'vitest'
import {
  DERIVED_CONTEXT_FIELDS,
  FORMULA_CONTEXT_FIELDS,
  IMPLEMENTED_FORMULA_IDS,
  evaluateQuantity,
  createFormulaRegistry,
  defaultFormulaRegistry,
  evaluateFormula,
  FORMULA_IDS,
  FormulaNotImplementedError,
  rateToProbability,
  UnknownFormulaError,
  withDerivedContext,
  type FormulaId,
  type SimContext,
  type SimContextField,
} from '../src/index'
import { ctxWith } from './helpers'

const ctx = ctxWith()

describe('formula registry', () => {
  it('registers exactly the ids section 4.6 lists', () => {
    expect([...defaultFormulaRegistry.keys()].sort()).toEqual([...FORMULA_IDS].sort())
  })

  it('throws rather than returning a silent zero for an unimplemented formula', () => {
    // Every id WITHOUT a real implementation must still throw. A stub that
    // returned 0 would sail through validation and ship a boss dropping
    // nothing (Phase 1's decision) — that guard has to survive real
    // implementations landing alongside the stubs.
    for (const id of FORMULA_IDS) {
      if (IMPLEMENTED_FORMULA_IDS.has(id)) continue
      expect(() => evaluateFormula(id, {}, ctx), id).toThrow(FormulaNotImplementedError)
    }
  })

  it('implemented ids evaluate instead of throwing, and are a strict subset', () => {
    // This test is the trip wire's other half: it fires when the set of real
    // implementations changes, which is the moment to re-check that the one
    // above still covers everything it should.
    expect([...IMPLEMENTED_FORMULA_IDS].sort()).toEqual([
      'doom_of_mokhaiotl_deep_rolls',
      'lunar_chest_standard_rolls',
      'zalcano_crystal_shards',
      'zalcano_mvp_only',
      'zalcano_mvp_share',
    ])
    for (const id of IMPLEMENTED_FORMULA_IDS) {
      expect(FORMULA_IDS).toContain(id)
      expect(() => evaluateQuantity(id, {}, { ...ctx, delveLevel: 12 })).not.toThrow()
    }
    // One roll of the '>8' row per deep-delve level, and none before delve 9.
    expect(evaluateQuantity('doom_of_mokhaiotl_deep_rolls', {}, { ...ctx, delveLevel: 12 })).toBe(4)
    expect(evaluateQuantity('doom_of_mokhaiotl_deep_rolls', {}, { ...ctx, delveLevel: 3 })).toBe(0)

    // 1/3/6 standard-loot rolls for 1/2/3 Moons — 3x per extra Moon, not
    // additive (the wiki disclaims both wrong readings explicitly).
    const moons = (m: SimContext['moonsKilled']) =>
      evaluateQuantity('lunar_chest_standard_rolls', {}, { ...ctx, moonsKilled: m })
    expect(moons(['blood'])).toBe(1)
    expect(moons(['blood', 'blue'])).toBe(3)
    expect(moons(['blood', 'blue', 'eclipse'])).toBe(6)
    expect(moons([])).toBe(0)
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

/**
 * `FORMULA_CONTEXT_FIELDS` is what lets the UI discover a control it would
 * otherwise have no way to know about — Zalcano's `isMVP` appears nowhere in
 * the boss document, only inside two formulas. A hand-maintained declaration
 * of "what this function reads" rots silently, so it is checked against
 * behaviour rather than trusted: vary a field the formula does NOT declare and
 * its output must not move.
 */
describe('FORMULA_CONTEXT_FIELDS matches what the formulas actually read', () => {
  const ALL_FIELDS = Object.keys(ctxWith()) as SimContextField[]

  /** Two contrasting values per field, enough to move any real dependency. */
  function variantsOf(field: SimContextField): [unknown, unknown] {
    switch (field) {
      case 'members':
      case 'ringOfWealth':
      case 'onSlayerTask':
      case 'perfectKill':
      case 'isMVP':
        return [false, true]
      case 'questsComplete':
        return [[], ['Dragon Slayer II']]
      case 'moonsKilled':
        return [[], ['blood', 'blue', 'eclipse']]
      case 'variant':
        return ['normal', 'awakened']
      case 'ownedCounts':
        return [{}, { 'crystal-shard': 5 }]
      case 'fishingLevel':
        return [1, 99]
      default:
        return [0, 500]
    }
  }

  it('declares an entry for every registered id', () => {
    expect(Object.keys(FORMULA_CONTEXT_FIELDS).sort()).toEqual([...FORMULA_IDS].sort())
  })

  it('never lists a derived field without also reaching it through its inputs', () => {
    // A UI expands a derived field to its inputs, so declaring `totalDamage`
    // is meaningful only if the inputs it comes from are controllable.
    for (const [derived, inputs] of Object.entries(DERIVED_CONTEXT_FIELDS)) {
      for (const [id, fields] of Object.entries(FORMULA_CONTEXT_FIELDS)) {
        if (!fields.includes(derived as SimContextField)) continue
        expect(inputs.length, `${id} declares ${derived}`).toBeGreaterThan(0)
      }
    }
  })

  it('an undeclared field never changes an implemented formula’s output', () => {
    for (const id of IMPLEMENTED_FORMULA_IDS) {
      const declared = new Set(FORMULA_CONTEXT_FIELDS[id])
      // A declared derived field means its inputs legitimately move the
      // output too, since `withDerivedContext` recomputes it from them.
      for (const [derived, inputs] of Object.entries(DERIVED_CONTEXT_FIELDS)) {
        if (declared.has(derived as SimContextField)) {
          for (const input of inputs) declared.add(input)
        }
      }

      for (const field of ALL_FIELDS) {
        if (declared.has(field)) continue
        const [a, b] = variantsOf(field)
        const evaluate = (value: unknown): number =>
          defaultFormulaRegistry.get(id)!(
            {},
            withDerivedContext({ ...ctxWith(), [field]: value } as SimContext)
          )
        expect(evaluate(a), `${id} moved when undeclared '${field}' changed`).toBe(evaluate(b))
      }
    }
  })

  it('every declared field genuinely moves at least one implemented formula', () => {
    // The other direction: an over-broad declaration would add a UI control
    // that does nothing, which is its own kind of lie.
    for (const id of IMPLEMENTED_FORMULA_IDS) {
      const declared = FORMULA_CONTEXT_FIELDS[id]
      expect(declared.length, `${id} implements something but declares no fields`).toBeGreaterThan(0)
    }
  })
})
