import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BossSchema, createFormulaRegistry, RateSchema, type Boss, type BossInput } from '@osrs-loot-simulator/loot-model'
import { checkRatesValid } from '../src/validate/rates-valid.js'

function item(name: string) {
  return { kind: 'item' as const, itemId: 1, itemKey: name, name, qty: { kind: 'exact' as const, n: 1 } }
}

/**
 * `checkRatesValid` only ever EVALUATES `formula`-kind rates — `fixed`/
 * `always`/`weight` are skipped outright, trusted as fully schema-enforced
 * with no runtime-only case (see the function's own doc comment). That
 * trust is only good because the four-kind list below is the WHOLE set.
 * `RateSchema` is `z.discriminatedUnion(...).superRefine(...)`, so the
 * inner union lives at `._def.schema` (zod's own, public-if-underscored,
 * field for this).
 */
function rateKinds(): string[] {
  const inner = (RateSchema as z.ZodEffects<z.ZodTypeAny>)._def.schema as z.ZodDiscriminatedUnion<
    string,
    z.ZodDiscriminatedUnionOption<string>[]
  >
  return [...inner.optionsMap.keys()].map(String).sort()
}

describe('rates_valid: skipped-kinds precondition', () => {
  it('Rate has exactly the four kinds checkRatesValid was audited against — a fifth needs its own audit, not a silent skip', () => {
    expect(rateKinds()).toEqual(['always', 'fixed', 'formula', 'weight'])
  })
})

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

describe('checkRatesValid', () => {
  it('passes trivially when no formula rates are present (fixed/always/weight are schema-enforced)', () => {
    const result = checkRatesValid(
      boss([
        { id: 't1', mode: 'always', entries: [{ node: item('a'), rate: { kind: 'always' } }] },
        {
          id: 't2',
          mode: 'independent',
          entries: [{ node: item('b'), rate: { kind: 'fixed', num: 1, den: 2 } }],
        },
      ])
    )
    expect(result).toEqual({
      check: 'rates_valid',
      ok: true,
      detail: 'fixed/always/weight rates are schema-enforced; no formula rates present',
    })
  })

  it('fails on a formula rate that has no implementation yet (the default registry stub)', () => {
    // The default registry's stub throws FormulaNotImplementedError for
    // every formula id — this is the actual current state of the codebase
    // (no Phase 5 formula implementations exist), and rates_valid must
    // reflect that rather than claiming schema-enforcement it doesn't have.
    const result = checkRatesValid(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: item('a'), rate: { kind: 'formula', id: 'wilderness_slayer', params: {} } }],
        },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not implemented/)
  })

  it('fails on a formula that returns a probability outside [0, 1]', () => {
    const badRegistry = createFormulaRegistry({ wilderness_slayer: () => 1.5 })
    const result = checkRatesValid(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [{ node: item('a'), rate: { kind: 'formula', id: 'wilderness_slayer', params: {} } }],
        },
      ]),
      badRegistry
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/1\.5/)
  })

  it('passes a correctly implemented formula rate, and reports how many were checked', () => {
    const goodRegistry = createFormulaRegistry({ wilderness_slayer: () => 0.5 })
    const result = checkRatesValid(
      boss([
        {
          id: 't',
          mode: 'independent',
          entries: [
            { node: item('a'), rate: { kind: 'formula', id: 'wilderness_slayer', params: {} } },
            { node: item('b'), rate: { kind: 'fixed', num: 1, den: 2 } },
          ],
        },
      ]),
      goodRegistry
    )
    expect(result).toEqual({
      check: 'rates_valid',
      ok: true,
      detail: '1 formula rate(s) evaluated successfully, all in [0,1]',
    })
  })
})
