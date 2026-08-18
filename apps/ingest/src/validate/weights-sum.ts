import {
  DEFAULT_SIM_CONTEXT,
  defaultFormulaRegistry,
  evaluateWeight,
  type FormulaRegistry,
  type Rate,
  type SimContext,
  type Table,
} from '@osrs-loot-simulator/loot-model'

/**
 * The `weights_sum` check (PROJECT_PLAN.md 7): for each weighted table, per
 * condition-variant, weights sum to the denominator.
 *
 * An entry with no `members` condition belongs to every variant; a
 * `members: true`/`false` condition scopes it to one. This mirrors
 * `apps/ingest/src/triage/classify.ts`'s `groupByDenominator`, but runs
 * against the canonical `Table`, after parsing, rather than raw bucket rows.
 */

export interface WeightsSumFailure {
  tableId: string
  variant: 'members' | 'f2p' | 'flat'
  sum: number
  denominator: number
}

export interface WeightsSumResult {
  check: 'weights_sum'
  ok: boolean
  detail?: string
  failures: WeightsSumFailure[]
}

/**
 * A weight's numeric value, resolving the `FormulaRef` arm against a context.
 *
 * Evaluated under a single context, the same limitation `rates_valid` and
 * `qty_sane` carry and record (docs/HANDOFF.md landmine #11b): real in
 * principle, and the reason this takes the context as a parameter rather than
 * hiding a default inside the loop.
 */
function weightOf(rate: Rate, ctx: SimContext, formulas: FormulaRegistry): number {
  if (rate.kind !== 'weight') return 0
  if (typeof rate.weight === 'number') return rate.weight
  return evaluateWeight(rate.weight.id, rate.weight.params, ctx, formulas)
}

function variantSum(
  table: Table,
  exclude: (memberValue: boolean) => boolean,
  ctx: SimContext,
  formulas: FormulaRegistry
): number {
  let sum = 0
  for (const entry of table.entries) {
    if (entry.rate.kind !== 'weight') continue
    const membersCondition = (entry.conditions ?? []).find((c) => c.kind === 'members')
    if (membersCondition?.kind === 'members' && exclude(membersCondition.value)) continue
    sum += weightOf(entry.rate, ctx, formulas)
  }
  return sum
}

export function checkWeightsSum(
  tables: readonly Table[],
  ctx: SimContext = DEFAULT_SIM_CONTEXT,
  formulas: FormulaRegistry = defaultFormulaRegistry
): WeightsSumResult {
  const failures: WeightsSumFailure[] = []

  for (const table of tables) {
    if (table.mode !== 'weighted' || table.denominator === undefined) continue

    // Distinct `members` VALUES present in this table, not just whether any
    // marker exists. That distinction is the point: Obor/Bryophyta's
    // section-level split (see `assemble-boss.ts`'s `conditionsFor`) tags
    // EVERY entry in a table with the SAME value, because the other
    // variant's rows live in an entirely separate table object (its own
    // heading, its own denominator) — not, like Brutus, as condition-excluded
    // rows sharing this one. A table with zero or one distinct value has
    // nothing to split within itself and is checked the same lenient way as
    // an unmarked table (shortfall is a legitimate implicit `nothing`, only
    // overflow is a defect); a table with BOTH values present is Brutus'
    // shape, where each variant's own rows must independently reconcile to
    // the full denominator.
    const membershipValues = new Set<boolean>()
    for (const entry of table.entries) {
      const c = (entry.conditions ?? []).find((cond) => cond.kind === 'members')
      if (c?.kind === 'members') membershipValues.add(c.value)
    }

    if (membershipValues.size < 2) {
      const sum = variantSum(table, () => false, ctx, formulas)
      if (Math.abs(sum - table.denominator) > 1e-9 && sum > table.denominator) {
        failures.push({ tableId: table.id, variant: 'flat', sum, denominator: table.denominator })
      }
      continue
    }

    const membersSum = variantSum(table, (value) => value === false, ctx, formulas)
    const f2pSum = variantSum(table, (value) => value === true, ctx, formulas)
    if (Math.abs(membersSum - table.denominator) > 1e-9) {
      failures.push({
        tableId: table.id,
        variant: 'members',
        sum: membersSum,
        denominator: table.denominator,
      })
    }
    if (Math.abs(f2pSum - table.denominator) > 1e-9) {
      failures.push({ tableId: table.id, variant: 'f2p', sum: f2pSum, denominator: table.denominator })
    }
  }

  return {
    check: 'weights_sum',
    ok: failures.length === 0,
    detail:
      failures.length === 0
        ? undefined
        : failures
            .map((f) => `table '${f.tableId}' ${f.variant} sums to ${f.sum}, denominator ${f.denominator}`)
            .join('; '),
    failures,
  }
}
