import type { Table } from '@osrs-loot-simulator/loot-model'

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

function variantSum(table: Table, exclude: (memberValue: boolean) => boolean): number {
  let sum = 0
  for (const entry of table.entries) {
    if (entry.rate.kind !== 'weight') continue
    const membersCondition = (entry.conditions ?? []).find((c) => c.kind === 'members')
    if (membersCondition?.kind === 'members' && exclude(membersCondition.value)) continue
    sum += entry.rate.weight
  }
  return sum
}

export function checkWeightsSum(tables: readonly Table[]): WeightsSumResult {
  const failures: WeightsSumFailure[] = []

  for (const table of tables) {
    if (table.mode !== 'weighted' || table.denominator === undefined) continue
    const hasMarkers = table.entries.some((entry) =>
      (entry.conditions ?? []).some((c) => c.kind === 'members')
    )

    if (!hasMarkers) {
      const sum = variantSum(table, () => false)
      if (Math.abs(sum - table.denominator) > 1e-9 && sum > table.denominator) {
        failures.push({ tableId: table.id, variant: 'flat', sum, denominator: table.denominator })
      }
      continue
    }

    const membersSum = variantSum(table, (value) => value === false)
    const f2pSum = variantSum(table, (value) => value === true)
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
    detail: failures.length === 0 ? undefined : `${failures.length} table/variant mismatch(es)`,
    failures,
  }
}
