import {
  compileBoss,
  effectiveWeightedPool,
  suppressedByPreroll,
  type CompiledBoss,
  type CompiledNode,
  type CompiledRolls,
  type CompiledTable,
  type CompileOptions,
} from './compile.js'
import {
  expectedDrawsWithoutReplacement,
  gateAllows,
  independentHitChance,
  prerollHitChance,
} from './expected-value.js'
import type {
  Boss,
  Entry,
  FormulaId,
  LeafEntry,
  LeafNode,
  Node,
  OwnershipGate,
  SimContext,
  Table,
} from './schema.js'

/**
 * The one formula whose per-kill probability changes across the kill sweep
 * (ToA's thread-of-Elidinis/keris-jewel curve, which ramps with `killCount`
 * up to a 3x cap). Every other formula-driven rate is a function of a
 * `SimContext` this module holds fixed for the whole sweep, so it is exactly
 * as constant as any non-formula rate.
 */
const KILLCOUNT_DEPENDENT_FORMULA_IDS: ReadonlySet<FormulaId> = new Set(['toa_bad_luck_mitigation'])

/**
 * The real mechanic this models (`toa_bad_luck_mitigation`) caps its ramp at
 * a kill count of `1.5 * den`, which is at most a few dozen for every
 * shipped source. 500 steps is generous headroom, not a tuned bound.
 */
const MAX_KILLCOUNT_RAMP_STEPS = 500

export const MILESTONE_TARGETS: readonly number[] = [0.5, 0.75, 0.9, 0.95, 0.99, 0.995, 0.999]

export type ItemProbabilityClassification =
  | { kind: 'exact' }
  | { kind: 'unsupported'; reason: 'ownership-gated' | 'item-not-found' }

export interface MilestoneRow {
  /** One of `MILESTONE_TARGETS`. */
  target: number
  /** Kills needed for cumulative P(>=1) to reach `target`; `Infinity` if the item can never drop under this context. */
  kills: number
}

export interface ItemMilestoneResult {
  itemKey: string
  classification: ItemProbabilityClassification
  /** Present only when `classification.kind === 'exact'`. */
  milestones?: MilestoneRow[]
  /** Present only when the per-kill probability is the same for every kill in the sweep (absent for the kill-count-ramp case, where there is no single number). */
  constantPerKillProbability?: number
}

// ---------------------------------------------------------------------------
// Structural reachability — used by both the classifier and the probability
// walk below, so "does this node/table ever reach the item" cannot disagree
// between the two.
// ---------------------------------------------------------------------------

function nodeReachesItem(node: CompiledNode, itemSlot: number): boolean {
  switch (node.kind) {
    case 'nothing':
      return false
    case 'item':
      return node.slot === itemSlot
    case 'table':
      return tableReachesItem(node.table, itemSlot)
  }
}

function tableReachesItem(table: CompiledTable, itemSlot: number): boolean {
  return table.nodes.some((node) => nodeReachesItem(node, itemSlot))
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Ownership-gate safety check for one table already known to reach the item.
 *
 * `weighted` tables (including a compiled `oneOf`) share one denominator
 * across every entry — `effectiveWeightedPool` renormalises it around
 * whichever gated entries are currently excluded, so a gate on ANY sibling
 * entry can move the queried item's own rate as that sibling's ownership
 * changes over the sweep (Lunar Chest's set pieces, ToA's keris jewels). The
 * only safe shape is exactly one gate in the whole table, keyed to the
 * queried item itself: `itemMilestones` pins that item's own `ownedCounts` to
 * 0 for the entire sweep (see below), so a pure self-gate resolves to a
 * constant for the whole "haven't got one yet" window this function answers.
 *
 * `preroll`/`always`/`independent` tables have no shared denominator — a
 * gate on one entry never affects another's probability — so only gates on
 * entries that themselves reach the item matter, and a self-gate there is
 * always safe regardless of `below`/`atLeast` (pinning the item's own
 * `ownedCounts` to 0 makes a `below` gate constantly satisfied and an
 * `atLeast` gate constantly unsatisfied for the whole sweep — exactly ToA's
 * thread-of-Elidinis, which is two such entries partitioning "don't have one
 * yet" from "already have one"). A gate keyed to a DIFFERENT item is treated
 * conservatively as disqualifying even here, since this model has no way to
 * track how that other item's ownership would evolve mid-sweep.
 */
function classifyTableGating(table: CompiledTable, itemSlot: number, itemKey: string): 'ok' | 'gated' {
  const gates = table.ownershipGates
  if (gates !== null) {
    if (table.mode === 'weighted') {
      const gateEntries = gates
        .map((gate, i) => (gate !== null ? { gate, i } : null))
        .filter((entry): entry is { gate: OwnershipGate; i: number } => entry !== null)
      const soleSelfGate =
        gateEntries.length === 1 &&
        gateEntries[0]!.gate.itemKey === itemKey &&
        nodeReachesItem(table.nodes[gateEntries[0]!.i]!, itemSlot)
      if (!soleSelfGate) return 'gated'
    } else {
      for (let i = 0; i < table.nodes.length; i++) {
        if (!nodeReachesItem(table.nodes[i]!, itemSlot)) continue
        const gate = gates[i] ?? null
        if (gate !== null && gate.itemKey !== itemKey) return 'gated'
      }
    }
  }

  for (const node of table.nodes) {
    if (node.kind === 'table' && tableReachesItem(node.table, itemSlot)) {
      if (classifyTableGating(node.table, itemSlot, itemKey) === 'gated') return 'gated'
    }
  }
  return 'ok'
}

/**
 * An item reachable from more than one top-level table is common and
 * ordinary (a guaranteed always-table currency alongside the same currency
 * in the main weighted table, e.g. Zulrah's scales) — `exactHitProbability`
 * below composes across every reaching table correctly regardless of how
 * many there are or what modes they mix, so this classifier only needs to
 * check ownership-gating on each one.
 */
function classifyItemReachability(
  compiled: CompiledBoss,
  itemSlot: number,
  itemKey: string
): ItemProbabilityClassification {
  const reachableTopLevel = compiled.tables.filter((table) => tableReachesItem(table, itemSlot))
  if (reachableTopLevel.length === 0) return { kind: 'unsupported', reason: 'item-not-found' }
  const anyGated = reachableTopLevel.some((table) => classifyTableGating(table, itemSlot, itemKey) === 'gated')
  return anyGated ? { kind: 'unsupported', reason: 'ownership-gated' } : { kind: 'exact' }
}

// ---------------------------------------------------------------------------
// Exact per-kill hit probability — mirrors expected-value.ts's
// accumulateNode/accumulateTable walk, but composes true "at least once"
// probabilities (unions/first-hit-chains) instead of linear expectations.
// ---------------------------------------------------------------------------

function withRolls(rolls: CompiledRolls, onePass: number): number {
  if (rolls.kind === 'chance') return rolls.p * onePass
  return rolls.n === 1 ? onePass : 1 - (1 - onePass) ** rolls.n
}

function unionOf(probabilities: readonly number[]): number {
  let miss = 1
  for (const p of probabilities) miss *= 1 - p
  return 1 - miss
}

function nodeHitProbability(
  node: CompiledNode,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>
): number {
  switch (node.kind) {
    case 'nothing':
      return 0
    case 'item':
      return node.slot === itemSlot ? 1 : 0
    case 'table': {
      const p1 = tableHitProbability(node.table, itemSlot, ownedCounts)
      return node.drawsPerHit === 1 ? p1 : 1 - (1 - p1) ** node.drawsPerHit
    }
  }
}

function tableHitProbability(
  table: CompiledTable,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>
): number {
  if (!tableReachesItem(table, itemSlot)) return 0

  switch (table.mode) {
    case 'always':
    case 'independent': {
      const contributions = table.nodes.map((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return 0
        const p = nodeHitProbability(node, itemSlot, ownedCounts)
        return table.mode === 'independent' ? p * table.probs[i]! : p
      })
      return withRolls(table.rolls, unionOf(contributions))
    }

    case 'preroll': {
      // First-hit-wins chain: entry i only fires if every earlier one missed.
      // The per-kill outcome is a true partition, so this sum is exact, not
      // an approximation of it — it's the same accumulation
      // `accumulateTable`'s preroll case already does, which is why it's
      // also exactly `expectedDrops` for this mode.
      let survived = 1
      let total = 0
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        const p = table.probs[i]!
        total += survived * p * nodeHitProbability(node, itemSlot, ownedCounts)
        survived *= 1 - p
      })
      return total
    }

    case 'weighted': {
      const pool = effectiveWeightedPool(table, (itemKey) => ownedCounts[itemKey] ?? 0)
      if (table.withoutReplacement && table.rolls.kind === 'count' && table.rolls.n > 1) {
        const reachingIndices: number[] = []
        table.nodes.forEach((node, i) => {
          if (nodeHitProbability(node, itemSlot, ownedCounts) > 0) reachingIndices.push(i)
        })
        if (reachingIndices.length === 0) return 0
        // Merge every entry reaching the item into one synthetic slot BEFORE
        // sampling without replacement, not after: "P(>=1 of a subset drawn)"
        // is only exact this way, because the entries' draw events are not
        // independent of each other (drawing one shrinks the pool the others
        // compete over) — combining separately-computed per-entry
        // probabilities with a union formula would be wrong.
        let mergedWeight = 0
        const otherWeights: number[] = []
        pool.weights.forEach((weight, i) => {
          if (reachingIndices.includes(i)) mergedWeight += weight
          else otherWeights.push(weight)
        })
        const mergedWeights = new Float64Array([mergedWeight, ...otherWeights])
        const expected = expectedDrawsWithoutReplacement(mergedWeights, pool.denominator, table.rolls.n)
        return expected[0]!
      }
      if (pool.denominator <= 0) return 0
      let p1 = 0
      table.nodes.forEach((node, i) => {
        const nodeP = nodeHitProbability(node, itemSlot, ownedCounts)
        if (nodeP > 0) p1 += nodeP * (pool.weights[i]! / pool.denominator)
      })
      return withRolls(table.rolls, p1)
    }
  }
}

/**
 * True P(this item drops at least once this kill), composed across EVERY
 * top-level table that reaches it — an item guaranteed by an `always` table
 * and also possibly drawn from the main `weighted` table (Zulrah's scales)
 * is the ordinary case, not an edge case, so this has to combine multiple
 * reaching tables correctly rather than assume there is only one.
 *
 * Tracks two running probabilities while walking `compiled.tables` in
 * document order, mirroring `expectedValue`'s own `chainAlive` bookkeeping
 * but split by whether the item has already been secured:
 *
 *   `pAlive` — P(the main chain is still alive AND the item has not dropped
 *              from anything processed so far)
 *   `pDead`  — P(the main chain has already ended AND the item has not
 *              dropped from any UNCONDITIONAL table processed so far — a
 *              chain-gated table contributes nothing once the chain is dead,
 *              so only `always`/`independent` tables can still move this)
 *
 * The final answer is `1 - (pAlive + pDead)`: everything not accounted for
 * by "still chasing it" is exactly "already got it".
 *
 * Each table updates these by at most two operations:
 *
 * 1. **Peel.** If the table reaches the item with probability `pItem`
 *    (computed once via `tableHitProbability`), `pItem` worth of whichever
 *    branches this table actually fires in has just been "won" and leaves
 *    both running totals — `pAlive` always (a chain-gated table only fires
 *    in the alive branch to begin with), `pDead` too when the table is
 *    unconditional (an `always`/`independent` table fires regardless of
 *    chain state, so it can still win the item even after the chain died).
 *
 * 2. **Transition**, for the two modes that can end the main chain
 *    (`preroll`, and `independent` with `suppressesFollowing`): some of the
 *    surviving `pAlive` mass moves to `pDead` — specifically the slice where
 *    the chain died from a DIFFERENT entry than the one(s) reaching our
 *    item. That slice is `anyHit - pItem`, where `anyHit` is the table's own
 *    "did anything at all fire" probability (`prerollHitChance`/
 *    `independentHitChance`, already used by `expectedValue` for the same
 *    purpose). This identity holds for both modes despite their different
 *    entry semantics: `preroll` entries are mutually exclusive by
 *    construction (first-hit-wins), so `anyHit - pItem` is a direct
 *    subtraction; `independent` entries are mutually INDEPENDENT, but
 *    factoring `1 - anyHit = (1 - pItem) * Π(1-p_j over non-reaching
 *    entries)` gives the identical `anyHit - pItem` for "some other entry
 *    fired, and it wasn't via a reaching entry" once the reaching entries'
 *    own `pItem` has already been peeled out — this doc's PR history has the
 *    full derivation if this needs re-deriving.
 *
 * A table that neither reaches the item nor transitions the chain (the
 * overwhelming majority, in any real document) touches neither running
 * total at all.
 */
function exactHitProbability(
  compiled: CompiledBoss,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>
): number {
  let pAlive = 1
  let pDead = 0

  for (const table of compiled.tables) {
    const reaches = tableReachesItem(table, itemSlot)
    const pItem = reaches ? tableHitProbability(table, itemSlot, ownedCounts) : 0
    const gated = suppressedByPreroll(table.mode) // preroll | weighted: dead once the chain is dead
    const transitions = table.mode === 'preroll' || table.suppressesFollowing === true

    if (transitions) {
      const anyHit = table.mode === 'preroll' ? prerollHitChance(table) : independentHitChance(table, ownedCounts)
      const deadCarry = gated ? pDead : pDead * (1 - pItem)
      pDead = deadCarry + pAlive * (anyHit - pItem)
      pAlive *= 1 - anyHit
    } else if (reaches) {
      pAlive *= 1 - pItem
      if (!gated) pDead *= 1 - pItem
    }
  }

  return 1 - (pAlive + pDead)
}

// ---------------------------------------------------------------------------
// Structural formula-id scan (pre-compile) — decides constant vs. varying
// without evaluating anything, so it can never be fooled by a formula that
// coincidentally agrees at two probe points but differs elsewhere.
// ---------------------------------------------------------------------------

function collectFormulaIdsToItem(
  boss: Boss,
  itemKey: string,
  sharedTables: ReadonlyMap<string, Table>
): ReadonlySet<FormulaId> {
  const found = new Set<FormulaId>()
  const onStack = new Set<string>()

  const visitRate = (rate: Entry['rate'] | LeafEntry['rate']): void => {
    if (rate.kind === 'formula') found.add(rate.id)
  }

  const visitNode = (node: Node | LeafNode): boolean => {
    switch (node.kind) {
      case 'item':
        return node.itemKey === itemKey
      case 'nothing':
        return false
      case 'tableRef': {
        const target = sharedTables.get(node.ref)
        return target !== undefined && visitTable(target)
      }
      case 'oneOf': {
        let reaches = false
        for (const entry of node.entries) {
          if (visitNode(entry.node)) {
            reaches = true
            visitRate(entry.rate)
          }
        }
        return reaches
      }
    }
  }

  function visitTable(table: Table): boolean {
    // Structural cycle guard only — no need to mirror compile.ts's
    // condition filtering here, see this function's exported caller's doc.
    if (onStack.has(table.id)) return false
    onStack.add(table.id)
    let reaches = false
    for (const entry of table.entries) {
      if (visitNode(entry.node)) {
        reaches = true
        visitRate(entry.rate)
      }
    }
    onStack.delete(table.id)
    return reaches
  }

  for (const table of boss.tables) visitTable(table)
  return found
}

// ---------------------------------------------------------------------------
// Milestone math
// ---------------------------------------------------------------------------

export function killsForTarget(perKillP: number, target: number): number {
  if (perKillP <= 0) return Infinity
  if (perKillP >= 1) return 1
  return Math.ceil(Math.log(1 - target) / Math.log(1 - perKillP))
}

function computeConstantMilestones(perKillP: number): MilestoneRow[] {
  return MILESTONE_TARGETS.map((target) => ({ target, kills: killsForTarget(perKillP, target) }))
}

/**
 * Forward-walks kill index 0, 1, 2, ... recompiling with `killCount` set to
 * the kill index each time (never the page's own live context — the sweep
 * always starts the mitigation counter fresh) and the queried item's own
 * `ownedCounts` pinned to 0 throughout (this function only ever answers
 * "kills to a FIRST copy"). Once the per-kill probability stops changing
 * (the mitigation curve has hit its cap), the remaining kills for any
 * still-unmet milestone are solved in closed form against the survival
 * product already accumulated — solving `survival * (1-p)^m <= 1-target`
 * for `m`, NOT by subtracting probabilities across the boundary (survival
 * composes multiplicatively, never additively).
 */
function computeVaryingMilestones(
  boss: Boss,
  ctx: SimContext,
  itemKey: string,
  options: CompileOptions
): MilestoneRow[] {
  const rows: MilestoneRow[] = []
  let survival = 1
  let previousP: number | null = null
  let targetIndex = 0

  for (let killIndex = 0; killIndex < MAX_KILLCOUNT_RAMP_STEPS && targetIndex < MILESTONE_TARGETS.length; killIndex++) {
    const stepCtx: SimContext = {
      ...ctx,
      killCount: killIndex,
      ownedCounts: { ...ctx.ownedCounts, [itemKey]: 0 },
    }
    const compiled = compileBoss(boss, stepCtx, options)
    const itemSlot = compiled.items.findIndex((item) => item.itemKey === itemKey)
    const p = exactHitProbability(compiled, itemSlot, compiled.ctx.ownedCounts)
    survival *= 1 - p

    while (targetIndex < MILESTONE_TARGETS.length && 1 - survival >= MILESTONE_TARGETS[targetIndex]!) {
      rows.push({ target: MILESTONE_TARGETS[targetIndex]!, kills: killIndex + 1 })
      targetIndex++
    }

    if (previousP !== null && p > 0 && Math.abs(p - previousP) < 1e-12) {
      while (targetIndex < MILESTONE_TARGETS.length) {
        const target = MILESTONE_TARGETS[targetIndex]!
        const remaining = Math.ceil(Math.log((1 - target) / survival) / Math.log(1 - p))
        rows.push({ target, kills: killIndex + 1 + Math.max(0, remaining) })
        targetIndex++
      }
      return rows
    }
    previousP = p
  }

  while (targetIndex < MILESTONE_TARGETS.length) {
    rows.push({ target: MILESTONE_TARGETS[targetIndex]!, kills: Infinity })
    targetIndex++
  }
  return rows
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function itemMilestones(
  boss: Boss,
  ctx: SimContext,
  itemKey: string,
  options: CompileOptions = {}
): ItemMilestoneResult {
  // The question is always "kills to a FIRST copy" — pin the queried item's
  // own entering count to 0 regardless of what the live context says, so an
  // ownership gate on the item itself resolves to a constant for the whole
  // window this function answers (see classifyTableGating's doc).
  const baseCtx: SimContext = { ...ctx, ownedCounts: { ...ctx.ownedCounts, [itemKey]: 0 } }
  const compiled = compileBoss(boss, baseCtx, options)
  const itemSlot = compiled.items.findIndex((item) => item.itemKey === itemKey)

  if (itemSlot === -1) {
    return { itemKey, classification: { kind: 'unsupported', reason: 'item-not-found' } }
  }

  const classification = classifyItemReachability(compiled, itemSlot, itemKey)
  if (classification.kind !== 'exact') {
    return { itemKey, classification }
  }

  const sharedTables = options.tables ?? new Map<string, Table>()
  const dependsOnKillCount = [...collectFormulaIdsToItem(boss, itemKey, sharedTables)].some((id) =>
    KILLCOUNT_DEPENDENT_FORMULA_IDS.has(id)
  )

  if (!dependsOnKillCount) {
    const perKillP = exactHitProbability(compiled, itemSlot, compiled.ctx.ownedCounts)
    return {
      itemKey,
      classification,
      milestones: computeConstantMilestones(perKillP),
      constantPerKillProbability: perKillP,
    }
  }

  return {
    itemKey,
    classification,
    milestones: computeVaryingMilestones(boss, ctx, itemKey, options),
  }
}
