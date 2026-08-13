import { entryApplies } from './conditions.js'
import {
  defaultFormulaRegistry,
  evaluateMultiplier,
  evaluateQuantity,
  rateToProbability,
  type FormulaRegistry,
} from './formulas.js'
import type {
  Boss,
  Entry,
  LeafEntry,
  Multiplier,
  Node,
  OwnershipGate,
  QtySpec,
  SimContext,
  Table,
  TableMode,
} from './schema.js'

/**
 * Both the simulator and the analytic EV walk this compiled form, so the two
 * can never drift apart on what a table means. Conditions are resolved once
 * here because `SimContext` is fixed for the duration of a run.
 */

export interface CompiledItem {
  itemId: number | null
  itemKey: string
  name: string
}

/**
 * `QtySpec` minus its `formula` variant. `compileNode`'s `item` case always
 * resolves a formula-driven quantity to a plain `exact` value at compile
 * time (`SimContext` is fixed for the run, so there's nothing to
 * re-evaluate per roll) — this type says so, so `rollQty`/`meanQty` don't
 * need a `formula` case they'd never actually reach.
 */
export type ResolvedQtySpec = Exclude<QtySpec, { kind: 'formula' }>

export type CompiledNode =
  | { kind: 'item'; slot: number; qty: ResolvedQtySpec }
  | { kind: 'nothing' }
  /**
   * `qtyMultiplier` is this specific `tableRef` access's own scaling
   * (`TableRefNode.qtyMultiplier`, resolved once here), separate from the
   * referenced `CompiledTable`'s own `qtyMultiplier` — the two compose at
   * whichever point a quantity is finally recorded.
   *
   * `drawsPerHit` is how many times the referenced table is evaluated once
   * this access hits (`TableRefNode.drawsPerHit`, normalised to 1 here so
   * neither consumer needs an `undefined` case). Orthogonal to
   * `qtyMultiplier`: that one scales the size of each yielded stack, this one
   * scales how many separate yields happen.
   */
  | { kind: 'table'; table: CompiledTable; qtyMultiplier: number; drawsPerHit: number }

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
  /** Scales every quantity rolled from this table's own entries. 1 when absent. */
  qtyMultiplier: number
  /**
   * `independent` only: a hit on any entry ends the main-drop chain for the
   * rest of the document, the same chain a preroll hit ends. `false` for
   * every table that doesn't opt in — see `Table.suppressesFollowing`.
   */
  suppressesFollowing: boolean
  /**
   * Parallel to `nodes`/`weights`/`probs`; `null` for every entry that has no
   * `ownershipGate`, and `null` for the WHOLE array when nothing in this
   * table has one — the fast-path sentinel `simulate.ts`/`expected-value.ts`
   * check once per table, not once per entry, to skip Extension B's
   * machinery entirely for every table that doesn't use it (which is every
   * table in every one of the 36 sources verified before Extension B).
   * Deliberately NOT applied by the static `entryApplies` filter above —
   * see `OwnershipGateSchema`'s comment for why an ownership-gated entry
   * always survives compile-time filtering regardless of the entering
   * `ownedCounts`, to be resolved dynamically instead.
   */
  ownershipGates: ReadonlyArray<OwnershipGate | null> | null
}

export interface CompiledBoss {
  boss: Boss
  ctx: SimContext
  items: CompiledItem[]
  tables: CompiledTable[]
  /** Every `itemKey` any `ownershipGate` anywhere in `tables` references. Empty for a boss that uses none — the guard `simulate.ts` checks to skip tracking entirely. */
  trackedItemKeys: ReadonlySet<string>
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
  private readonly slots = new Map<string, number>()
  readonly items: CompiledItem[] = []

  /**
   * Keyed by `itemKey`, not `itemId` — `itemId` can be null for an item this
   * pipeline could not resolve to a single id (a multi-id page, an
   * unresolved lookup), and `itemKey` is the one identifier every item node
   * is guaranteed to carry. A noted and an unnoted stack of the same item
   * share an `itemKey` and therefore a slot; the gp maths agrees.
   */
  slotFor(itemId: number | null, itemKey: string, name: string): number {
    const existing = this.slots.get(itemKey)
    if (existing !== undefined) return existing
    const slot = this.items.length
    this.slots.set(itemKey, slot)
    this.items.push({ itemId, itemKey, name })
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
  const trackedItemKeys = new Set<string>()

  const compileMultiplier = (multiplier: Multiplier | undefined): number => {
    if (multiplier === undefined) return 1
    if (typeof multiplier === 'number') return multiplier
    return evaluateMultiplier(multiplier.id, multiplier.params, ctx, formulas)
  }

  const compileQty = (qty: QtySpec): ResolvedQtySpec => {
    if (qty.kind !== 'formula') return qty
    return { kind: 'exact', n: evaluateQuantity(qty.id, qty.params, ctx, formulas) }
  }

  /**
   * `rolls` as a `formula`-kind `Rate` is the one case that means "an integer
   * count", not "a Bernoulli chance" — see `TableSchema`'s comment on
   * `rolls`. Every other non-numeric `rolls` (fixed/always/the rejected
   * weight kind) keeps its existing meaning.
   */
  const compileRolls = (rolls: Table['rolls']): CompiledRolls => {
    if (typeof rolls === 'number') return { kind: 'count', n: rolls }
    if (rolls.kind === 'always') return { kind: 'count', n: 1 }
    if (rolls.kind === 'formula') {
      return { kind: 'count', n: evaluateQuantity(rolls.id, rolls.params, ctx, formulas) }
    }
    return { kind: 'chance', p: rateToProbability(rolls, ctx, formulas) }
  }

  const compileNode = (node: Node, tableId: string, path: string[]): CompiledNode => {
    switch (node.kind) {
      case 'item':
        return {
          kind: 'item',
          slot: items.slotFor(node.itemId, node.itemKey, node.name),
          qty: compileQty(node.qty),
        }
      case 'nothing':
        return { kind: 'nothing' }
      case 'tableRef': {
        const target = shared.get(node.ref)
        if (target === undefined) throw new UnresolvedTableRefError(node.ref)
        return {
          kind: 'table',
          table: compileTable(target, path),
          qtyMultiplier: compileMultiplier(node.qtyMultiplier),
          drawsPerHit: node.drawsPerHit ?? 1,
        }
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
      qtyMultiplier: 1,
      // A `oneOf` is reached inline, not through a `tableRef` node, so there
      // is no access line for `drawsPerHit` to attach to — it selects exactly
      // one entry, exactly once.
      drawsPerHit: 1,
      table: {
        id,
        mode: 'weighted',
        rolls: { kind: 'count', n: 1 },
        withoutReplacement: false,
        // `LeafEntry` (oneOf's entry shape) carries no `ownershipGate` — none
        // of the four Extension B sources need ownership *inside* a oneOf,
        // so it's out of scope rather than added speculatively.
        nodes: applicable.map((entry) => compileNode(entry.node, id, path)),
        weights,
        cum: cumulative(weights),
        denominator: total,
        probs: new Float64Array(0),
        qtyMultiplier: 1,
        suppressesFollowing: false,
        ownershipGates: null,
      },
    }
  }

  const compileTable = (table: Table, path: string[]): CompiledTable => {
    const memoized = memo.get(table.id)
    if (memoized !== undefined) return memoized
    if (path.includes(table.id)) throw new CircularTableRefError([...path, table.id])

    const nextPath = [...path, table.id]
    // `entryApplies` only ever reads `entry.conditions` — `ownershipGate` is
    // a separate field it doesn't know about, so an ownership-gated entry
    // survives this static pass regardless of the entering `ownedCounts`,
    // by construction. See `OwnershipGateSchema`'s comment.
    const applicable: Entry[] = table.entries.filter((entry) => entryApplies(entry, ctx))
    const nodes = applicable.map((entry) => compileNode(entry.node, table.id, nextPath))

    const rawGates = applicable.map((entry) => entry.ownershipGate ?? null)
    const ownershipGates = rawGates.some((gate) => gate !== null) ? rawGates : null
    if (ownershipGates !== null) {
      for (const gate of ownershipGates) {
        if (gate !== null) trackedItemKeys.add(gate.itemKey)
      }
    }

    const weights = new Float64Array(applicable.length)
    const probs = new Float64Array(applicable.length)
    let denominator = table.denominator ?? 0

    if (table.mode === 'weighted') {
      let total = 0
      applicable.forEach((entry, i) => {
        const weight = entry.rate.kind === 'weight' ? entry.rate.weight : 0
        weights[i] = weight
        total += weight
      })
      // An explicit `nothing` entry excluded by ITS OWN condition shrinks the
      // effective denominator by its own weight, rather than leaving an
      // equal-sized unaccounted-for gap that would just re-create an
      // implicit `nothing` of the same size. This is how "ring of wealth
      // removes the nothing slot" (PROJECT_PLAN.md 4.4) is expressed: the gem
      // table's `Nothing` row is gated on `ringOfWealth: false`; wearing RoW
      // excludes that row AND shrinks the pool so the remaining items now
      // span the whole table, matching the wiki's own post-RoW fractions
      // (e.g. uncut sapphire 32/128 -> 32/65, not 32/128 unchanged). A rule
      // about the `nothing` node kind, not about a particular table.
      for (const entry of table.entries) {
        if (entry.node.kind !== 'nothing' || entryApplies(entry, ctx)) continue
        denominator -= entry.rate.kind === 'weight' ? entry.rate.weight : 0
      }
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
      denominator,
      probs,
      qtyMultiplier: compileMultiplier(table.qtyMultiplier),
      suppressesFollowing: table.suppressesFollowing ?? false,
      ownershipGates,
    }
    memo.set(table.id, compiled)
    return compiled
  }

  const tables = boss.tables.map((table) => compileTable(table, []))
  return { boss, ctx, items: items.items, tables, trackedItemKeys }
}

/** Whether a gate currently permits its entry, given a live or static owned count. */
export function ownershipGateSatisfied(gate: OwnershipGate, owned: number): boolean {
  return gate.when === 'below' ? owned < gate.n : owned >= gate.n
}

export interface EffectivePool {
  weights: Float64Array
  cum: Float64Array
  denominator: number
}

/**
 * Recomputes a `weighted`-mode table's pool with any currently-excluded
 * ownership-gated entries removed (Lunar Chest's per-set duplicate
 * protection: draw from unowned pieces only). Deliberately a SEPARATE
 * mechanism from `compileTable`'s static `nothing`-kind denominator shrink
 * above — that one is resolved once, scoped to condition-excluded `nothing`
 * nodes; this one is re-evaluated by the caller (once per kill in
 * `simulate.ts`, against a live tracker; once in `expected-value.ts`,
 * against the static entering `ownedCounts`) and scoped to
 * `ownershipGate`-carrying entries only. Returns the table's own arrays
 * unchanged when it has no gates at all — cheap enough for a caller to call
 * unconditionally, though both current callers guard on
 * `table.ownershipGates !== null` first anyway to skip even that.
 */
export function effectiveWeightedPool(
  table: CompiledTable,
  ownedCountFor: (itemKey: string) => number
): EffectivePool {
  const gates = table.ownershipGates
  if (gates === null) {
    return { weights: table.weights, cum: table.cum, denominator: table.denominator }
  }
  const weights = table.weights.slice()
  let denominator = table.denominator
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i] ?? null
    if (gate === null) continue
    if (!ownershipGateSatisfied(gate, ownedCountFor(gate.itemKey))) {
      denominator -= weights[i]!
      weights[i] = 0
    }
  }
  return { weights, cum: cumulative(weights), denominator }
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
 * Which modes are part of the main-drop chain, and therefore suppressed once
 * something upstream in the document hits. `always` entries drop
 * unconditionally and `independent` entries are rolled separately (4.3), so
 * neither is in the chain. This is a rule about modes, stated once — never
 * about a particular boss.
 *
 * Two triggers now end that chain, and they share this one definition of what
 * gets ended: a `preroll` hit (4.3) and a hit in a table flagged
 * `suppressesFollowing` (CoX's unique table — see `Table.suppressesFollowing`).
 * The name is kept for the original, still-dominant trigger.
 */
export function suppressedByPreroll(mode: TableMode): boolean {
  return mode === 'preroll' || mode === 'weighted'
}

export function meanQty(qty: ResolvedQtySpec): number {
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
