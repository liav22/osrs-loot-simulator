import {
  defaultFormulaRegistry,
  rateToProbability,
  resolveSimContext,
  type Boss,
  type FormulaRegistry,
} from '@osrs-loot-simulator/loot-model'

export interface RatesValidResult {
  check: 'rates_valid'
  ok: boolean
  detail: string
}

/**
 * PROJECT_PLAN.md 7: every probability lands in [0, 1], no NaN.
 *
 * `fixed`/`always`/`weight` rates are fully enforced by the loot-model
 * schema at parse time — `RateSchema`'s `superRefine` rejects `num > den`,
 * `weight` must be positive — so there is genuinely no runtime case left to
 * check for them; a hardcoded pass for those three kinds is correct, not
 * lazy (confirmed against `packages/loot-model/test/schema.test.ts`, which
 * already exercises the rejection).
 *
 * `formula` rates are the one kind the schema CANNOT validate: `params` is
 * an opaque `Record<string, unknown>`, and a formula's actual numeric output
 * only exists once evaluated against a `SimContext` — `evaluateFormula`
 * (`packages/loot-model/src/formulas.ts`) already throws a `RangeError` if
 * that output falls outside [0, 1] or is non-finite, but nothing at ingest
 * time was ever calling it to find out. This check is the one place that
 * attempts that evaluation before `verified` is decided, rather than
 * silently claiming "enforced by the schema" for a case the schema cannot
 * see and letting a bad formula surface only as an uncaught crash deep in
 * `simulate`/`expectedValue` later.
 */
export function checkRatesValid(
  boss: Boss,
  formulas: FormulaRegistry = defaultFormulaRegistry
): RatesValidResult {
  const ctx = resolveSimContext(boss, {})
  const failures: string[] = []
  let formulaCount = 0

  for (const table of boss.tables) {
    for (const entry of table.entries) {
      if (entry.rate.kind !== 'formula') continue
      formulaCount++
      try {
        rateToProbability(entry.rate, ctx, formulas)
      } catch (error) {
        failures.push(
          `table '${table.id}': formula '${entry.rate.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  if (failures.length > 0) {
    return { check: 'rates_valid', ok: false, detail: failures.join('; ') }
  }
  return {
    check: 'rates_valid',
    ok: true,
    detail:
      formulaCount === 0
        ? 'fixed/always/weight rates are schema-enforced; no formula rates present'
        : `${formulaCount} formula rate(s) evaluated successfully, all in [0,1]`,
  }
}
