import {
  defaultFormulaRegistry,
  evaluateWeight,
  rateToProbability,
  resolveSimContext,
  type Boss,
  type Entry,
  type FormulaRegistry,
  type LeafEntry,
  type Rate,
} from '@osrs-loot-simulator/loot-model'

export interface RatesValidResult {
  check: 'rates_valid'
  ok: boolean
  detail: string
}

/**
 * PROJECT_PLAN.md 7: every probability lands in [0, 1], no NaN.
 *
 * `fixed`/`always` rates are fully enforced by the loot-model schema at parse
 * time — `RateSchema`'s `superRefine` rejects `num > den` — so there is
 * genuinely no runtime case left to check for them; a hardcoded pass for those
 * two kinds is correct, not lazy (confirmed against
 * `packages/loot-model/test/schema.test.ts`, which already exercises the
 * rejection).
 *
 * **`weight` used to be in that sentence and no longer is.** A weight may now
 * be a `FormulaRef` (Tombs of Amascut's raid-level-scaled unique pool — see
 * `WeightRateSchema`), and a formula's output is exactly as invisible to the
 * schema as a formula rate's: `params` is an opaque record and the number only
 * exists once evaluated. A formula weight that resolved to zero or NaN would
 * silently delete its entry from the pool and leave a plausible distribution
 * over the rest, so it is evaluated here alongside formula rates. A plain
 * numeric weight is still schema-enforced positive and needs nothing.
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

  // Descends into `oneOf`, unlike the original flat loop. ToA's formula
  // weights live ONLY inside a `oneOf` pool, so a top-level-only walk would
  // count zero of them and report a confident pass over nothing — the vacuous
  // green that landmine #11f exists to prevent.
  const checkRate = (rate: Rate, where: string): void => {
    if (rate.kind === 'formula') {
      formulaCount++
      try {
        rateToProbability(rate, ctx, formulas)
      } catch (error) {
        failures.push(
          `${where}: formula '${rate.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return
    }
    if (rate.kind === 'weight' && typeof rate.weight !== 'number') {
      formulaCount++
      try {
        evaluateWeight(rate.weight.id, rate.weight.params, ctx, formulas)
      } catch (error) {
        failures.push(
          `${where}: formula weight '${rate.weight.id}' ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  const checkEntry = (entry: Entry | LeafEntry, where: string): void => {
    checkRate(entry.rate, where)
    if (entry.node.kind === 'oneOf') {
      entry.node.entries.forEach((leaf, i) => checkEntry(leaf, `${where} oneOf[${i}]`))
    }
  }

  for (const table of boss.tables) {
    table.entries.forEach((entry, i) => checkEntry(entry, `table '${table.id}' entry[${i}]`))
  }

  if (failures.length > 0) {
    return { check: 'rates_valid', ok: false, detail: failures.join('; ') }
  }
  return {
    check: 'rates_valid',
    ok: true,
    detail:
      formulaCount === 0
        ? 'fixed/always rates and numeric weights are schema-enforced; no formula rates or weights present'
        : `${formulaCount} formula rate(s)/weight(s) evaluated successfully`,
  }
}
