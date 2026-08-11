import { entryApplies } from './conditions'
import { defaultFormulaRegistry, rateToProbability, type FormulaRegistry } from './formulas'
import type { Boss, Entry, LeafEntry, Node, QtySpec, SimContext, Table, TableMode } from './schema'

/**
 * Both the simulator and the analytic EV walk this compiled form, so the two
 * can never drift apart on what a table means. Conditions are resolved once
 * here because `SimContext` is fixed for the duration of a run.
 */

export interface CompiledItem {
  itemId: number
  name: string
}

export type CompiledNode =
  | { kind: 'item'; slot: number; qty: QtySpec }
  | { kind: 'nothing' }
  | { kind: 'table'; table: CompiledTable }

export type CompiledRolls =
  | { kind: 'count'; n: number }
  /** `rolls` given as a fixed/formula Rate: the table is rolled once with probability p. */
  | { kind: 'chance'; p: number }

export interface CompiledTable {
  id: string
  mode: TableMode
  rolls: CompiledRolls
  withoutReplacement: boolean
  /** Parallel to `weights` / `probs` / `cum`; entries filtered out by conditions are gone. */
  nodes: CompiledNode[]
  /** weighted only: per-entry weight. */
  weights: Float64Array
  /** weighted only: running total of `weights`. */
  cum: Float64Array
  /** weighted only: the table's denominator; the shortfall is an implicit `nothing`. */
  denominator: number
  /** always/preroll/independent: per-entry absolute probability. */
  probs: Float64Array
}

export interface CompiledBoss {
  boss: Boss
  ctx: SimContext
  items: CompiledItem[]
  tables: CompiledTable[]
}

export interface CompileOptions {
  /** Shared `data/tables/` records, keyed by id, for `tableRef` resolution. */
  tables?: ReadonlyMap<string, Table>
  formulas?: FormulaRegistry
}

export class UnresolvedTableRefError extends Error {
  constructor(readonly ref: string) {
    super(`tableRef '${ref}' could not be resolved; pass it via options.tables`)
    this.name = 'UnresolvedTableRefError'
  }
}

export class CircularTableRefError extends Error {
  constructor(readonly path: readonly string[]) {
    super(`Circular tableRef: ${path.join(' -> ')}`)
    this.name = 'CircularTableRefError'
  }
}

export class WeightsExceedDenominatorError extends Error {
  constructor(
    readonly tableId: string,
    readonly total: number,
    readonly denominator: number
  ) {
    super(
      `Table '${tableId}' has applicable weights summing to ${total}, ` +
        `which exceeds its denominator of ${denominator}`
    )
    this.name = 'WeightsExceedDenominatorError'
  }
}

class ItemIndex {
  private readonly slots = new Map<number, number>()
  readonly items: CompiledItem[] = []

  /**
   * Keyed by `itemId` alone, so a noted and an unnoted stack of the same item
   * share a slot. They are the same tradeable item and the gp maths agrees.
   */
  slotFor(itemId: number, name: string): number {
    const existing = this.slots.get(itemId)
    if (existing !== undefined) return existing
    const slot = this.items.length
    this.slots.set(itemId, slot)
    this.items.push({ itemId, name })
    return slot
  }
}

export function compileBoss(
  boss: Boss,
  ctx: SimContext,
  options: CompileOptions = {}
): CompiledBoss {
  const formulas = options.formulas ?? defaultFormulaRegistry
  const shared = options.tables ?? new Map<string, Table>()
  const items = new ItemIndex()
  const memo = new Map<string, CompiledTable>()

  const compileRolls = (rolls: Table['rolls']): CompiledRolls => {
    if (typeof rolls === 'number') return { kind: 'count', n: rolls }
    if (rolls.kind === 'always') return { kind: 'count', n: 1 }
    return { kind: 'chance', p: rateToProbability(rolls, ctx, formulas) }
  }

  const compileNode = (node: Node, tableId: string, path: string[]): CompiledNode => {
    switch (node.kind) {
      case 'item':
        return { kind: 'item', slot: items.slotFor(node.itemId, node.name), qty: node.qty }
      case 'nothing':
        return { kind: 'nothing' }
      case 'tableRef': {
        const target = shared.get(node.ref)
        if (target === undefined) throw new UnresolvedTableRefError(node.ref)
        return { kind: 'table', table: compileTable(target, path) }
      }
      case 'oneOf':
        return compileOneOf(node.entries, tableId, path)
    }
  }

  /**
   * `oneOf` is an inline weighted sub-table whose denominator is the sum of the
   * weights that survive condition filtering — it selects exactly one entry.
   */
  const compileOneOf = (entries: LeafEntry[], tableId: string, path: string[]): CompiledNode => {
    const applicable = entries.filter((entry) => entryApplies(entry, ctx))
    const weights = new Float64Array(applicable.length)
    let total = 0
    applicable.forEach((entry, i) => {
      const weight = entry.rate.kind === 'weight' ? entry.rate.weight : 0
      weights[i] = weight
      total += weight
    })
    if (total <= 0) return { kind: 'nothing' }

    const id = `${tableId}#oneOf`
    return {
      kind: 'table',
      table: {
        id,
        mode: 'weighted',
        rolls: { kind: 'count', n: 1 },
        withoutReplacement: false,
        nodes: applicable.map((entry) => compileNode(entry.node, id, path)),
        weights,
        cum: cumulative(weights),
        denominator: total,
        probs: new Float64Array(0),
      },
    }
  }

  const compileTable = (table: Table, path: string[]): CompiledTable => {
    const memoized = memo.get(table.id)
    if (memoized !== undefined) return memoized
    if (path.includes(table.id)) throw new CircularTableRefError([...path, table.id])

    const nextPath = [...path, table.id]
    const applicable: Entry[] = table.entries.filter((entry) => entryApplies(entry, ctx))
    const nodes = applicable.map((entry) => compileNode(entry.node, table.id, nextPath))

    const weights = new Float64Array(applicable.length)
    const probs = new Float64Array(applicable.length)

    if (table.mode === 'weighted') {
      let total = 0
      applicable.forEach((entry, i) => {
        const weight = entry.rate.kind === 'weight' ? entry.rate.weight : 0
        weights[i] = weight
        total += weight
      })
      const denominator = table.denominator ?? 0
      if (total > denominator + 1e-9) {
        throw new WeightsExceedDenominatorError(table.id, total, denominator)
      }
    } else {
      applicable.forEach((entry, i) => {
        probs[i] = rateToProbability(entry.rate, ctx, formulas)
      })
    }

    const compiled: CompiledTable = {
      id: table.id,
      mode: table.mode,
      rolls: compileRolls(table.rolls),
      withoutReplacement: table.withoutReplacement,
      nodes,
      weights,
      cum: table.mode === 'weighted' ? cumulative(weights) : new Float64Array(0),
      denominator: table.denominator ?? 0,
      probs,
    }
    memo.set(table.id, compiled)
    return compiled
  }

  const tables = boss.tables.map((table) => compileTable(table, []))
  return { boss, ctx, items: items.items, tables }
}

export function cumulative(weights: Float64Array): Float64Array {
  const cum = new Float64Array(weights.length)
  let running = 0
  for (let i = 0; i < weights.length; i++) {
    running += weights[i]!
    cum[i] = running
  }
  return cum
}

/**
 * Index of the first cumulative bucket strictly greater than `r`, or
 * `cum.length` when `r` falls in the implicit `nothing` remainder.
 */
export function pickIndex(cum: Float64Array, r: number): number {
  let lo = 0
  let hi = cum.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cum[mid]! <= r) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * A preroll hit short-circuits the remaining main-drop chain. `always` entries
 * drop unconditionally and `independent` entries are rolled separately (4.3),
 * so neither is part of that chain. This is a rule about modes, stated once —
 * never about a particular boss.
 */
export function suppressedByPreroll(mode: TableMode): boolean {
  return mode === 'preroll' || mode === 'weighted'
}

export function meanQty(qty: QtySpec): number {
  switch (qty.kind) {
    case 'exact':
      return qty.n
    case 'range':
      return (qty.min + qty.max) / 2
    case 'choice': {
      let total = 0
      for (const value of qty.values) total += value
      return total / qty.values.length
    }
  }
}
