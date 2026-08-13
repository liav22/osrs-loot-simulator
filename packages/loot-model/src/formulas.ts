import type { FormulaId, Rate, SimContext } from './schema.js'
import { FORMULA_IDS } from './schema.js'

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

function callFormula(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry
): number {
  const fn = registry.get(formulaId)
  if (fn === undefined) throw new UnknownFormulaError(formulaId)
  return fn(params, ctx)
}

/**
 * `[0, 1]`-probability contract — a formula used as a `Rate`. Kept under its
 * original name since it's part of the tested public API (see
 * `formulas.test.ts`); `evaluateQuantity`/`evaluateMultiplier` below are the
 * other two contracts a formula id can fulfil, added for the `QtySpec`,
 * `Table.rolls`, and `qtyMultiplier` formula variants. Which contract a given
 * formula id fulfils is a property of where it's used, not of `FormulaFn`'s
 * type — documented at each formula's registration site, not enforced by the
 * type system.
 */
export function evaluateFormula(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const probability = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError(`Formula '${formulaId}' returned ${probability}, expected [0, 1]`)
  }
  return probability
}

/**
 * Non-negative-quantity contract — a formula used as a `QtySpec` or as
 * `Table.rolls`' integer-count variant. Rounds to the nearest integer, since
 * every other `QtySpec`/`rolls` shape is integer-valued; a formula that needs
 * `trunc`-toward-zero behaviour (e.g. Doom of Mokhaiotl's per-level quantity
 * multiplier) does that internally before returning, making this rounding a
 * no-op for it.
 */
export function evaluateQuantity(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const value = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Formula '${formulaId}' returned ${value}, expected a non-negative quantity`)
  }
  return Math.round(value)
}

/**
 * Positive-multiplier contract — a formula used as `qtyMultiplier` on a
 * `Table` or `TableRefNode`. No upper bound (Duke Sucellus' +50% is 1.5,
 * Abyssal Sire's flat double is 2), and not rounded — a multiplier need not
 * be integer-valued.
 */
export function evaluateMultiplier(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const value = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Formula '${formulaId}' returned ${value}, expected a positive multiplier`)
  }
  return value
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
