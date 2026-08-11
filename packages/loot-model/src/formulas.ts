import type { FormulaId, Rate, SimContext } from './schema'
import { FORMULA_IDS } from './schema'

/** Returns a probability in [0, 1]. */
export type FormulaFn = (params: Record<string, unknown>, ctx: SimContext) => number

export type FormulaRegistry = ReadonlyMap<FormulaId, FormulaFn>

export class FormulaNotImplementedError extends Error {
  constructor(readonly formulaId: FormulaId) {
    super(
      `Formula '${formulaId}' is declared but not implemented yet. ` +
        `Real implementations land in Phase 5; pass a registry override to supply one now.`
    )
    this.name = 'FormulaNotImplementedError'
  }
}

export class UnknownFormulaError extends Error {
  constructor(readonly formulaId: string) {
    super(`Unknown formula '${formulaId}'`)
    this.name = 'UnknownFormulaError'
  }
}

/**
 * Phase 1 registers every id from section 4.6 with a stub that throws.
 * Throwing beats returning 0: a silent zero would sail through the `ev_matches`
 * validation check and ship a boss that drops nothing.
 */
function stubFormula(formulaId: FormulaId): FormulaFn {
  return () => {
    throw new FormulaNotImplementedError(formulaId)
  }
}

export function createFormulaRegistry(
  overrides: Partial<Record<FormulaId, FormulaFn>> = {}
): FormulaRegistry {
  const registry = new Map<FormulaId, FormulaFn>()
  for (const formulaId of FORMULA_IDS) {
    registry.set(formulaId, overrides[formulaId] ?? stubFormula(formulaId))
  }
  return registry
}

export const defaultFormulaRegistry: FormulaRegistry = createFormulaRegistry()

export function evaluateFormula(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const fn = registry.get(formulaId)
  if (fn === undefined) throw new UnknownFormulaError(formulaId)
  const probability = fn(params, ctx)
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError(`Formula '${formulaId}' returned ${probability}, expected [0, 1]`)
  }
  return probability
}

/**
 * Absolute probability of a rate. `weight` rates have no absolute probability
 * on their own — they are a share of the parent table's denominator — so they
 * are rejected here rather than silently coerced.
 */
export function rateToProbability(
  rate: Rate,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  switch (rate.kind) {
    case 'always':
      return 1
    case 'fixed':
      return rate.num / rate.den
    case 'formula':
      return evaluateFormula(rate.id, rate.params, ctx, registry)
    case 'weight':
      throw new TypeError(
        'weight rates are relative to a table denominator and have no standalone probability'
      )
  }
}
