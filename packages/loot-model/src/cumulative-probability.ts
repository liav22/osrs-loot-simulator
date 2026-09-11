import {
  compileBoss,
  effectiveWeightedPool,
  suppressedByPreroll,
  type CompiledBoss,
  type CompiledNode,
  type CompiledRolls,
  type CompiledTable,
  type CompileOptions,
  type EffectivePool,
} from './compile.js'
import { gateAllows, independentHitChance, prerollHitChance } from './expected-value.js'
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

/** Exponential-search ceiling for a milestone's kill count, before giving up and reporting `Infinity`. */
const MAX_SEARCH_KILLS = 2 ** 40

export const MILESTONE_TARGETS: readonly number[] = [0.5, 0.75, 0.9, 0.95, 0.99, 0.995, 0.999]

export type ItemProbabilityClassification =
  | { kind: 'exact' }
  | { kind: 'unsupported'; reason: 'ownership-gated' | 'item-not-found' }

export interface MilestoneRow {
  /** One of `MILESTONE_TARGETS`. */
  target: number
  /** Kills needed for cumulative P(>=`targetCount`) to reach `target`; `Infinity` if that many can never drop under this context. */
  kills: number
}

export interface ItemMilestoneResult {
  itemKey: string
  /** How many copies this result answers "kills needed for" — the whole distribution, not just P(>=1). */
  targetCount: number
  classification: ItemProbabilityClassification
  /** Present only when `classification.kind === 'exact'`. */
  milestones?: MilestoneRow[]
  /** P(>=1 this kill), regardless of `targetCount` — a general rarity indicator. Absent for the kill-count-ramp case, where there is no single number. */
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
        gateEntries[0]!.gate.resetPerSet === undefined &&
        nodeReachesItem(table.nodes[gateEntries[0]!.i]!, itemSlot)
      if (!soleSelfGate) return 'gated'
    } else {
      for (let i = 0; i < table.nodes.length; i++) {
        if (!nodeReachesItem(table.nodes[i]!, itemSlot)) continue
        const gate = gates[i] ?? null
        if (gate !== null && (gate.itemKey !== itemKey || gate.resetPerSet !== undefined)) return 'gated'
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
 * in the main weighted table, e.g. Zulrah's scales) — `exactOccurrencePmf`
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
// Occurrence-count PMFs
//
// Every probability below is a small array `pmf` where `pmf[i]` is P(exactly
// `i` occurrences of the target item), TRUNCATED to a shared `cap` (the
// caller's `targetCount`): entries at or beyond `cap` are dropped and folded
// into an implicit "cap or more" tail, since `1 - sum(pmf)` is all a caller
// ever needs from that tail. Truncating a polynomial before multiplying it
// never changes the low-order coefficients of the product (the dropped terms
// could only have contributed to degrees >= cap), so every combinator below
// is exact for indices < cap regardless of where it truncates.
//
// Two ways nodes combine, matching the two ways the model already lets
// multiple things happen from one roll:
//  - MIXTURE (weighted sum of PMFs): mutually exclusive branches — a weighted
//    draw or a preroll chain picks at most one outcome.
//  - CONVOLUTION (shift-and-add): independent contributions that can BOTH
//    happen in the same kill — `independent`-mode entries, repeated `rolls`,
//    or `drawsPerHit` — so their occurrence counts add together.
// ---------------------------------------------------------------------------

function deltaAt(cap: number, index: number): Float64Array<ArrayBufferLike> {
  const pmf = new Float64Array(cap)
  if (index < cap) pmf[index] = 1
  return pmf
}

function toCapLength(pmf: Float64Array<ArrayBufferLike>, cap: number): Float64Array<ArrayBufferLike> {
  if (pmf.length === cap) return pmf
  const out = new Float64Array(cap)
  const len = Math.min(cap, pmf.length)
  for (let i = 0; i < len; i++) out[i] = pmf[i]!
  return out
}

function mixPmfs(branches: ReadonlyArray<{ weight: number; pmf: Float64Array<ArrayBufferLike> }>, cap: number): Float64Array<ArrayBufferLike> {
  const result = new Float64Array(cap)
  for (const { weight, pmf } of branches) {
    if (weight === 0) continue
    const len = Math.min(cap, pmf.length)
    for (let i = 0; i < len; i++) result[i]! += weight * pmf[i]!
  }
  return result
}

function convolvePmfs(a: Float64Array<ArrayBufferLike>, b: Float64Array<ArrayBufferLike>, cap: number): Float64Array<ArrayBufferLike> {
  const result = new Float64Array(cap)
  const aLen = Math.min(cap, a.length)
  for (let i = 0; i < aLen; i++) {
    const ai = a[i]!
    if (ai === 0) continue
    const bLen = Math.min(cap - i, b.length)
    for (let j = 0; j < bLen; j++) result[i + j]! += ai * b[j]!
  }
  return result
}

/** `times` i.i.d. convolutions of `pmf` with itself, via binary exponentiation — O(cap^2 log(times)), not O(times). */
function convolvePower(pmf: Float64Array<ArrayBufferLike>, times: number, cap: number): Float64Array<ArrayBufferLike> {
  let result = deltaAt(cap, 0)
  let base = toCapLength(pmf, cap)
  let n = times
  while (n > 0) {
    if (n & 1) result = convolvePmfs(result, base, cap)
    n >>= 1
    if (n > 0) base = convolvePmfs(base, base, cap)
  }
  return result
}

function withRollsPmf(rolls: CompiledRolls, onePass: Float64Array<ArrayBufferLike>, cap: number): Float64Array<ArrayBufferLike> {
  if (rolls.kind === 'chance') {
    return mixPmfs(
      [
        { weight: 1 - rolls.p, pmf: deltaAt(cap, 0) },
        { weight: rolls.p, pmf: onePass },
      ],
      cap
    )
  }
  return rolls.n === 1 ? onePass : convolvePower(onePass, rolls.n, cap)
}

function nodeOccurrencePmf(
  node: CompiledNode,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>,
  cap: number
): Float64Array<ArrayBufferLike> {
  switch (node.kind) {
    case 'nothing':
      return deltaAt(cap, 0)
    case 'item':
      return deltaAt(cap, node.slot === itemSlot ? 1 : 0)
    case 'table': {
      const per = tableOccurrencePmf(node.table, itemSlot, ownedCounts, cap)
      return node.drawsPerHit === 1 ? per : convolvePower(per, node.drawsPerHit, cap)
    }
  }
}

/**
 * The without-replacement case needs its own walk rather than reusing
 * `expectedDrawsWithoutReplacement`'s per-slot "P(drawn)": that function
 * answers "was this SLOT drawn", which is only the same thing as "did our
 * item come out of it" when the slot's own node always yields the item
 * unconditionally. It does not when the slot is itself a nested `oneOf`
 * that only SOMETIMES resolves to the target (Ancient Chest's common-table
 * herb/seed pairs, `oneOf(herb, seed)` under one without-replacement slot) —
 * treating "slot drawn" as "item obtained" there overstates the item's own
 * odds by exactly the seed-branch's share. This walk tracks each slot's own
 * `nodeOccurrencePmf` and convolves it in only when that specific slot is
 * the one drawn, which is exact for both the always-yields and
 * sometimes-yields cases (and for more than one reaching slot, which the
 * previous "merge weights into one synthetic slot" approach could not
 * handle exactly either, since two slots being drawn together needed a
 * joint account of the process, not two independently-merged marginals).
 */
function withoutReplacementOccurrencePmf(
  table: CompiledTable,
  pool: EffectivePool,
  rolls: number,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>,
  cap: number
): Float64Array<ArrayBufferLike> {
  const nodePmfs = table.nodes.map((node) => nodeOccurrencePmf(node, itemSlot, ownedCounts, cap))
  const count = pool.weights.length
  const removed = new Uint8Array(count)
  let removedWeight = 0
  let totalWeight = 0
  for (let i = 0; i < count; i++) totalWeight += pool.weights[i]!
  const remainderWeight = pool.denominator - totalWeight

  const result = new Float64Array(cap)

  function walk(depth: number, prob: number, acc: Float64Array<ArrayBufferLike>): void {
    if (prob === 0) return
    if (depth === rolls) {
      for (let i = 0; i < cap; i++) result[i]! += prob * acc[i]!
      return
    }
    const available = pool.denominator - removedWeight
    if (available <= 0) {
      for (let i = 0; i < cap; i++) result[i]! += prob * acc[i]!
      return
    }
    for (let i = 0; i < count; i++) {
      if (removed[i] === 1) continue
      const weight = pool.weights[i]!
      if (weight <= 0) continue
      const p = prob * (weight / available)
      removed[i] = 1
      removedWeight += weight
      walk(depth + 1, p, convolvePmfs(acc, nodePmfs[i]!, cap))
      removed[i] = 0
      removedWeight -= weight
    }
    if (remainderWeight > 0) {
      walk(depth + 1, prob * (remainderWeight / available), acc)
    }
  }

  walk(0, 1, deltaAt(cap, 0))
  return result
}

function tableOccurrencePmf(
  table: CompiledTable,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>,
  cap: number
): Float64Array<ArrayBufferLike> {
  if (!tableReachesItem(table, itemSlot)) return deltaAt(cap, 0)

  switch (table.mode) {
    case 'always':
    case 'independent': {
      let onePass = deltaAt(cap, 0)
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        const nodePmf = nodeOccurrencePmf(node, itemSlot, ownedCounts, cap)
        const pFire = table.mode === 'independent' ? table.probs[i]! : 1
        const entryPmf =
          pFire === 1
            ? nodePmf
            : mixPmfs(
                [
                  { weight: 1 - pFire, pmf: deltaAt(cap, 0) },
                  { weight: pFire, pmf: nodePmf },
                ],
                cap
              )
        onePass = convolvePmfs(onePass, entryPmf, cap)
      })
      return withRollsPmf(table.rolls, onePass, cap)
    }

    case 'preroll': {
      // First-hit-wins chain: entry i only fires if every earlier one missed.
      // The per-kill outcome is a true partition, so a mixture over "which
      // entry (if any) fired" is exact, not an approximation of it.
      let survived = 1
      const branches: Array<{ weight: number; pmf: Float64Array<ArrayBufferLike> }> = []
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        const p = table.probs[i]!
        branches.push({ weight: survived * p, pmf: nodeOccurrencePmf(node, itemSlot, ownedCounts, cap) })
        survived *= 1 - p
      })
      branches.push({ weight: survived, pmf: deltaAt(cap, 0) })
      return mixPmfs(branches, cap)
    }

    case 'weighted': {
      const pool = effectiveWeightedPool(table, (itemKey) => ownedCounts[itemKey] ?? 0)
      if (table.withoutReplacement && table.rolls.kind === 'count' && table.rolls.n > 1) {
        return withoutReplacementOccurrencePmf(table, pool, table.rolls.n, itemSlot, ownedCounts, cap)
      }
      if (pool.denominator <= 0) return deltaAt(cap, 0)
      const branches: Array<{ weight: number; pmf: Float64Array<ArrayBufferLike> }> = []
      let usedWeight = 0
      table.nodes.forEach((node, i) => {
        const weight = pool.weights[i]!
        if (weight <= 0) return
        usedWeight += weight
        branches.push({ weight: weight / pool.denominator, pmf: nodeOccurrencePmf(node, itemSlot, ownedCounts, cap) })
      })
      const nothingMass = (pool.denominator - usedWeight) / pool.denominator
      if (nothingMass > 0) branches.push({ weight: nothingMass, pmf: deltaAt(cap, 0) })
      return withRollsPmf(table.rolls, mixPmfs(branches, cap), cap)
    }
  }
}

/**
 * The per-kill occurrence-count PMF, composed across EVERY top-level table
 * that reaches the item — an item guaranteed by an `always` table and also
 * possibly drawn from the main `weighted` table (Zulrah's scales) is the
 * ordinary case, not an edge case, so this has to combine multiple reaching
 * tables correctly rather than assume there is only one.
 *
 * Tracks two running PMFs while walking `compiled.tables` in document order,
 * mirroring `expectedValue`'s own `chainAlive` bookkeeping but split by
 * whether the main chain has already ended:
 *
 *   `pmfAlive[j]` — P(the main chain is still alive AND exactly `j`
 *                   occurrences have been obtained from anything so far)
 *   `pmfDead[j]`  — P(the main chain has already ended AND exactly `j`
 *                   occurrences have been obtained from anything
 *                   UNCONDITIONAL so far — a chain-gated table contributes
 *                   nothing once the chain is dead, so only `always`/
 *                   `independent` tables can still move this)
 *
 * The final PMF is `pmfAlive + pmfDead` pointwise: whatever branch the chain
 * ended up in, the occurrence count accumulated in that branch is the count
 * that matters.
 *
 * Each table updates these with at most two operations:
 *
 * 1. **Fold in.** The table's own occurrence PMF (`tableOccurrencePmf`,
 *    which already IS the identity `[1,0,0,...]` when the table doesn't
 *    reach the item, so this never needs an explicit reachability check
 *    here) convolves into `pmfAlive` always — a chain-gated table only
 *    fires in the alive branch — and into `pmfDead` too when the table is
 *    unconditional (`always`/`independent` fire regardless of chain state).
 *
 * 2. **Transition**, for the two modes that can end the main chain
 *    (`preroll`, and `independent` with `suppressesFollowing`): some of the
 *    surviving `pmfAlive` mass moves to `pmfDead`. Splitting the table's own
 *    outcome into "nothing fired" (prob `1 - anyHit`, no occurrences, stays
 *    alive), "some OTHER entry fired" (prob `anyHit - pItem`, no
 *    occurrences of THIS item, but the chain still dies), and "a reaching
 *    entry fired with k occurrences" (`tableOccurrencePmf`'s own mass at
 *    each index >= 1, which by construction can only come from a reaching
 *    entry) gives an exact shape for the alive-to-dead transfer without
 *    needing to decompose `preroll`'s first-hit-wins chain or
 *    `independent`'s mutual independence separately — `anyHit - pItem`
 *    holds for both for the same reason the scalar version of this
 *    function's derivation (see version history) established: `preroll`
 *    entries are mutually exclusive by construction, and `independent`
 *    entries' mutual independence factors the same way once the reaching
 *    entries' own mass is peeled out first.
 */
function exactOccurrencePmf(
  compiled: CompiledBoss,
  itemSlot: number,
  ownedCounts: Readonly<Record<string, number>>,
  cap: number
): Float64Array<ArrayBufferLike> {
  let pmfAlive = deltaAt(cap, 0)
  let pmfDead: Float64Array<ArrayBufferLike> = new Float64Array(cap)

  for (const table of compiled.tables) {
    const pItemPmf = tableOccurrencePmf(table, itemSlot, ownedCounts, cap)
    const gated = suppressedByPreroll(table.mode) // preroll | weighted: dead once the chain is dead
    const transitions = table.mode === 'preroll' || table.suppressesFollowing === true

    if (transitions) {
      const anyHit = table.mode === 'preroll' ? prerollHitChance(table) : independentHitChance(table, ownedCounts)
      const pItem = 1 - pItemPmf[0]!
      const otherEntryMass = Math.max(0, anyHit - pItem)

      const deadGainShape = new Float64Array(cap)
      deadGainShape[0] = otherEntryMass
      for (let k = 1; k < cap; k++) deadGainShape[k] = pItemPmf[k]!

      const newAlive = new Float64Array(cap)
      for (let i = 0; i < cap; i++) newAlive[i] = pmfAlive[i]! * (1 - anyHit)

      const deadCarry = gated ? pmfDead : convolvePmfs(pmfDead, pItemPmf, cap)
      const deadGain = convolvePmfs(pmfAlive, deadGainShape, cap)
      const newDead = new Float64Array(cap)
      for (let i = 0; i < cap; i++) newDead[i] = deadCarry[i]! + deadGain[i]!

      pmfAlive = newAlive
      pmfDead = newDead
    } else {
      pmfAlive = convolvePmfs(pmfAlive, pItemPmf, cap)
      if (!gated) pmfDead = convolvePmfs(pmfDead, pItemPmf, cap)
    }
  }

  const result = new Float64Array(cap)
  for (let i = 0; i < cap; i++) result[i] = pmfAlive[i]! + pmfDead[i]!
  return result
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

/** Closed form for `targetCount === 1` against a constant per-kill probability — the common case, computed without a search. */
export function killsForTarget(perKillP: number, target: number): number {
  if (perKillP <= 0) return Infinity
  if (perKillP >= 1) return 1
  return Math.ceil(Math.log(1 - target) / Math.log(1 - perKillP))
}

/** P(sum of `n` i.i.d. draws from `perKillPmf` is < `perKillPmf.length`), i.e. still short of the target after `n` kills. */
function survivalAtN(perKillPmf: Float64Array<ArrayBufferLike>, n: number): number {
  const cap = perKillPmf.length
  const pow = convolvePower(perKillPmf, n, cap)
  let sum = 0
  for (let i = 0; i < cap; i++) sum += pow[i]!
  return sum
}

/**
 * Smallest N such that P(>= `perKillPmf.length` occurrences after N i.i.d.
 * kills) reaches `target`, found by exponential-then-binary search over the
 * `survivalAtN` oracle — each oracle call costs O(cap^2 log N) via
 * `convolvePower`'s binary exponentiation, so this stays fast even for huge
 * N. Degenerates to `killsForTarget`'s closed form when `cap === 1`.
 */
function killsForTargetCount(perKillPmf: Float64Array<ArrayBufferLike>, target: number): number {
  const cap = perKillPmf.length
  if (cap === 1) return killsForTarget(1 - perKillPmf[0]!, target)
  if (1 - perKillPmf[0]! <= 0) return Infinity // the item can never drop at all

  let hi = 1
  while (1 - survivalAtN(perKillPmf, hi) < target) {
    if (hi >= MAX_SEARCH_KILLS) return Infinity
    hi *= 2
  }
  let lo = Math.floor(hi / 2)
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (1 - survivalAtN(perKillPmf, mid) >= target) hi = mid
    else lo = mid
  }
  return hi
}

function computeConstantMilestones(perKillPmf: Float64Array<ArrayBufferLike>): MilestoneRow[] {
  return MILESTONE_TARGETS.map((target) => ({ target, kills: killsForTargetCount(perKillPmf, target) }))
}

function pmfsEqual(a: Float64Array<ArrayBufferLike>, b: Float64Array<ArrayBufferLike>): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) >= 1e-12) return false
  }
  return true
}

/**
 * Forward-walks kill index 0, 1, 2, ... recompiling with `killCount` set to
 * the kill index each time (never the page's own live context — the sweep
 * always starts the mitigation counter fresh) and the queried item's own
 * `ownedCounts` pinned to 0 throughout (this function only ever answers
 * "kills to a first N copies"). `dist[j]` tracks P(cumulative occurrences
 * so far == j), convolved forward one kill's PMF at a time. Once the
 * per-kill PMF stops changing (the mitigation curve has hit its cap), the
 * remaining kills for any still-unmet milestone are solved by convolving
 * `dist` forward with `pmfStable^m` and binary-searching `m` — the same
 * `killsForTargetCount` oracle, just starting from `dist` instead of a
 * fresh delta at 0.
 */
function computeVaryingMilestones(
  boss: Boss,
  ctx: SimContext,
  itemKey: string,
  itemSlotHint: number,
  options: CompileOptions,
  cap: number
): MilestoneRow[] {
  const rows: MilestoneRow[] = []
  let dist = deltaAt(cap, 0)
  let previousPmf: Float64Array<ArrayBufferLike> | null = null
  let targetIndex = 0

  const cumulativeAtLeastTarget = (d: Float64Array<ArrayBufferLike>): number => {
    let sum = 0
    for (let i = 0; i < cap; i++) sum += d[i]!
    return 1 - sum
  }

  for (let killIndex = 0; killIndex < MAX_KILLCOUNT_RAMP_STEPS && targetIndex < MILESTONE_TARGETS.length; killIndex++) {
    const stepCtx: SimContext = {
      ...ctx,
      killCount: killIndex,
      ownedCounts: { ...ctx.ownedCounts, [itemKey]: 0 },
    }
    const compiled = compileBoss(boss, stepCtx, options)
    const itemSlot = compiled.items.findIndex((item) => item.itemKey === itemKey)
    const pmf = exactOccurrencePmf(compiled, itemSlot === -1 ? itemSlotHint : itemSlot, compiled.ctx.ownedCounts, cap)
    dist = convolvePmfs(dist, pmf, cap)

    while (targetIndex < MILESTONE_TARGETS.length && cumulativeAtLeastTarget(dist) >= MILESTONE_TARGETS[targetIndex]!) {
      rows.push({ target: MILESTONE_TARGETS[targetIndex]!, kills: killIndex + 1 })
      targetIndex++
    }

    if (previousPmf !== null && pmfsEqual(pmf, previousPmf)) {
      while (targetIndex < MILESTONE_TARGETS.length) {
        const target = MILESTONE_TARGETS[targetIndex]!
        const remaining = tailKillsFor(dist, pmf, target, cap)
        rows.push({ target, kills: killIndex + 1 + remaining })
        targetIndex++
      }
      return rows
    }
    previousPmf = pmf
  }

  while (targetIndex < MILESTONE_TARGETS.length) {
    rows.push({ target: MILESTONE_TARGETS[targetIndex]!, kills: Infinity })
    targetIndex++
  }
  return rows
}

/** Smallest `m` such that convolving `dist` forward with `m` more i.i.d. draws of `stablePmf` reaches `target`. */
function tailKillsFor(dist: Float64Array<ArrayBufferLike>, stablePmf: Float64Array<ArrayBufferLike>, target: number, cap: number): number {
  const already = (() => {
    let sum = 0
    for (let i = 0; i < cap; i++) sum += dist[i]!
    return 1 - sum
  })()
  if (already >= target) return 0
  if (1 - stablePmf[0]! <= 0) return Infinity

  const shortfallAtM = (m: number): number => {
    const projected = convolvePmfs(dist, convolvePower(stablePmf, m, cap), cap)
    let sum = 0
    for (let i = 0; i < cap; i++) sum += projected[i]!
    return 1 - sum
  }

  let hi = 1
  while (shortfallAtM(hi) < target) {
    if (hi >= MAX_SEARCH_KILLS) return Infinity
    hi *= 2
  }
  let lo = Math.floor(hi / 2)
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (shortfallAtM(mid) >= target) hi = mid
    else lo = mid
  }
  return hi
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function itemMilestones(
  boss: Boss,
  ctx: SimContext,
  itemKey: string,
  targetCount = 1,
  options: CompileOptions = {}
): ItemMilestoneResult {
  const cap = Math.max(1, Math.round(targetCount))

  // The question is always "kills to a first `cap` copies" — pin the
  // queried item's own entering count to 0 regardless of what the live
  // context says, so an ownership gate on the item itself resolves to a
  // constant for the whole window this function answers (see
  // classifyTableGating's doc).
  const baseCtx: SimContext = { ...ctx, ownedCounts: { ...ctx.ownedCounts, [itemKey]: 0 } }
  const compiled = compileBoss(boss, baseCtx, options)
  const itemSlot = compiled.items.findIndex((item) => item.itemKey === itemKey)

  if (itemSlot === -1) {
    return { itemKey, targetCount: cap, classification: { kind: 'unsupported', reason: 'item-not-found' } }
  }

  const classification = classifyItemReachability(compiled, itemSlot, itemKey)
  if (classification.kind !== 'exact') {
    return { itemKey, targetCount: cap, classification }
  }

  const sharedTables = options.tables ?? new Map<string, Table>()
  const dependsOnKillCount = [...collectFormulaIdsToItem(boss, itemKey, sharedTables)].some((id) =>
    KILLCOUNT_DEPENDENT_FORMULA_IDS.has(id)
  )

  if (!dependsOnKillCount) {
    const perKillPmf = exactOccurrencePmf(compiled, itemSlot, compiled.ctx.ownedCounts, cap)
    return {
      itemKey,
      targetCount: cap,
      classification,
      milestones: computeConstantMilestones(perKillPmf),
      constantPerKillProbability: 1 - perKillPmf[0]!,
    }
  }

  return {
    itemKey,
    targetCount: cap,
    classification,
    milestones: computeVaryingMilestones(boss, ctx, itemKey, itemSlot, options, cap),
  }
}
