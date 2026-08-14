import {
  compileBoss,
  effectiveWeightedPool,
  meanScaledQty,
  ownershipGateSatisfied,
  suppressedByPreroll,
  type CompiledBoss,
  type CompiledNode,
  type CompiledRolls,
  type CompiledTable,
  type CompileOptions,
} from './compile.js'
import type { Boss, QtyRounding, SimContext } from './schema.js'
import type { PriceLookup } from './simulate.js'

export interface ExpectedItem {
  itemId: number | null
  itemKey: string
  name: string
  /** Expected number of drops of this item per kill. */
  expectedDrops: number
  /** Expected units per kill. */
  expectedQuantity: number
  gpPerKill: number
}

export interface ExpectedValueResult {
  items: ExpectedItem[]
  gpPerKill: number
}

export interface ExpectedValueOptions extends CompileOptions {
  prices?: PriceLookup
}

/**
 * Sampling without replacement is walked exhaustively, which costs
 * O((entries + 1) ^ rolls). Four rolls is already far beyond anything the wiki
 * describes; beyond it, refuse rather than hang.
 */
export const MAX_WITHOUT_REPLACEMENT_ROLLS = 4

export class UnsupportedExpectedValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedExpectedValueError'
  }
}

const NO_PRICES: PriceLookup = () => 0

function expectedRolls(rolls: CompiledRolls): number {
  return rolls.kind === 'count' ? rolls.n : rolls.p
}

/**
 * Probability each entry is drawn at least once across `rolls` draws without
 * replacement. Each entry can be drawn at most once, so this is also its
 * expected draw count.
 */
export function expectedDrawsWithoutReplacement(
  weights: Float64Array,
  denominator: number,
  rolls: number
): Float64Array {
  if (rolls > MAX_WITHOUT_REPLACEMENT_ROLLS) {
    throw new UnsupportedExpectedValueError(
      `Analytic EV for withoutReplacement supports at most ` +
        `${MAX_WITHOUT_REPLACEMENT_ROLLS} rolls, got ${rolls}`
    )
  }

  const count = weights.length
  const expected = new Float64Array(count)
  const removed = new Uint8Array(count)

  let totalWeight = 0
  for (let i = 0; i < count; i++) totalWeight += weights[i]!
  // The `nothing` remainder is not an entry, so it never leaves the pool.
  const remainder = denominator - totalWeight

  let removedWeight = 0
  const walk = (depth: number, prob: number): void => {
    if (depth === rolls || prob === 0) return
    const available = denominator - removedWeight
    if (available <= 0) return

    for (let i = 0; i < count; i++) {
      if (removed[i] === 1) continue
      const weight = weights[i]!
      const p = prob * (weight / available)
      expected[i]! += p
      removed[i] = 1
      removedWeight += weight
      walk(depth + 1, p)
      removed[i] = 0
      removedWeight -= weight
    }

    if (remainder > 0) walk(depth + 1, prob * (remainder / available))
  }
  walk(0, 1)

  return expected
}

/**
 * The static counterpart of `simulate.ts`'s `gateAllows`: `expectedValue`
 * computes one kill's expectation given a FIXED `SimContext`, so ownership
 * is checked once against the entering `ownedCounts` — never a live tracker,
 * there's no "later kill in this run" for it to track. See
 * `OwnershipGateSchema`'s comment for why `expectedValue` needs nothing more
 * than this for correctness, unlike `simulate`.
 */
function gateAllows(
  table: CompiledTable,
  i: number,
  ownedCounts: Readonly<Record<string, number>>
): boolean {
  if (table.ownershipGates === null) return true
  const gate = table.ownershipGates[i] ?? null
  return gate === null || ownershipGateSatisfied(gate, ownedCounts[gate.itemKey] ?? 0)
}

/**
 * Two independent multipliers walk down together: `reach` is the expected
 * number of times this node is hit (a probability/count product, unrelated
 * to item size), `qtyMultiplier` is the accumulated `Table`/`TableRefNode`
 * quantity scaling on the path so far. Conflating them would corrupt
 * `drops[]` (how many times an item came up must not depend on how big each
 * stack is) — see docs/mechanics-model-proposal.md's Extension A.
 */
function accumulateNode(
  node: CompiledNode,
  reach: number,
  qtyMultiplier: number,
  qtyRounding: QtyRounding,
  compiled: CompiledBoss,
  drops: Float64Array,
  quantity: Float64Array
): void {
  switch (node.kind) {
    case 'nothing':
      return
    case 'item':
      drops[node.slot]! += reach
      // Exact, not `qtyMultiplier * meanQty(...)`: rounding makes the scaled
      // mean non-linear, so the analytic path enumerates the quantity's own
      // distribution rather than scaling its mean. See `meanScaledQty`.
      quantity[node.slot]! += reach * meanScaledQty(node.qty, qtyMultiplier, qtyRounding)
      return
    case 'table':
      // `drawsPerHit` evaluations of the referenced table, each independent
      // of the others, so the expectation is simply linear in the count —
      // one access hitting and drawing 10 times contributes exactly 10× what
      // drawing once would (Corporeal Beast). Note this multiplies `reach`,
      // not `qtyMultiplier`: it changes how many separate yields happen, not
      // how big each one is, which is what keeps `drops[]` (times an item
      // came up) correct rather than conflated with quantity.
      accumulateTable(
        node.table,
        reach * node.drawsPerHit,
        qtyMultiplier * node.qtyMultiplier,
        // Most-specific-wins, mirroring simulate.ts's `nestedRounding`.
        node.qtyRounding === 'round' ? qtyRounding : node.qtyRounding,
        compiled,
        drops,
        quantity
      )
      return
  }
}

function accumulateTable(
  table: CompiledTable,
  reach: number,
  qtyMultiplier: number,
  qtyRounding: QtyRounding,
  compiled: CompiledBoss,
  drops: Float64Array,
  quantity: Float64Array
): void {
  const rolls = expectedRolls(table.rolls)
  if (rolls === 0 || reach === 0) return
  const effectiveQty = qtyMultiplier * table.qtyMultiplier
  const effectiveRounding = table.qtyRounding === 'round' ? qtyRounding : table.qtyRounding

  const ownedCounts = compiled.ctx.ownedCounts

  switch (table.mode) {
    case 'always':
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        accumulateNode(node, reach * rolls, effectiveQty, effectiveRounding, compiled, drops, quantity)
      })
      return

    case 'independent':
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        accumulateNode(node, reach * rolls * table.probs[i]!, effectiveQty, effectiveRounding, compiled, drops, quantity)
      })
      return

    case 'preroll': {
      // Entries are checked in order; entry i is only reached if every earlier
      // one missed. Schema pins preroll tables to a single roll. A
      // gate-excluded entry is skipped without affecting `survived` — it
      // behaves as if it weren't in the chain at all, not as an automatic
      // miss that still "uses up" its position.
      let survived = 1
      table.nodes.forEach((node, i) => {
        if (!gateAllows(table, i, ownedCounts)) return
        const p = table.probs[i]!
        accumulateNode(node, reach * survived * p, effectiveQty, effectiveRounding, compiled, drops, quantity)
        survived *= 1 - p
      })
      return
    }

    case 'weighted': {
      // No-op (returns table.weights/denominator unchanged) when this table
      // has no ownership gates — see effectiveWeightedPool's comment.
      const pool = effectiveWeightedPool(table, (itemKey) => ownedCounts[itemKey] ?? 0)
      if (table.withoutReplacement && table.rolls.kind === 'count' && table.rolls.n > 1) {
        const expected = expectedDrawsWithoutReplacement(pool.weights, pool.denominator, table.rolls.n)
        table.nodes.forEach((node, i) => {
          accumulateNode(node, reach * expected[i]!, effectiveQty, effectiveRounding, compiled, drops, quantity)
        })
        return
      }
      // Every entry ownership-excluded (e.g. a fully-owned Lunar Chest set)
      // leaves nothing to draw from — contributes 0, not NaN from a 0/0.
      if (pool.denominator <= 0) return
      table.nodes.forEach((node, i) => {
        const p = pool.weights[i]! / pool.denominator
        accumulateNode(node, reach * rolls * p, effectiveQty, effectiveRounding, compiled, drops, quantity)
      })
      return
    }
  }
}

/** Probability that at least one entry of a preroll table hits. */
function prerollHitChance(table: CompiledTable): number {
  let miss = 1
  for (let i = 0; i < table.probs.length; i++) miss *= 1 - table.probs[i]!
  const hit = 1 - miss
  return table.rolls.kind === 'chance' ? hit * table.rolls.p : hit
}

/**
 * Probability that at least one entry of a `suppressesFollowing` table hits —
 * the analytic counterpart of the `suppressHit` flag `simulate.ts` sets. Every
 * entry is an independent Bernoulli trial (that's what `independent` means),
 * so the table misses entirely only when all of them miss, and a `rolls` count
 * of N repeats that whole independent pass N times.
 *
 * Gate-excluded entries are skipped rather than counted as guaranteed misses:
 * an ownership-gated entry that currently doesn't apply isn't in the table at
 * all this kill, matching how `accumulateTable`'s own `independent` case
 * treats it. No source combines the two features today; getting it right here
 * costs nothing and avoids a silent wrong answer if one ever does.
 */
function independentHitChance(
  table: CompiledTable,
  ownedCounts: Readonly<Record<string, number>>
): number {
  let miss = 1
  for (let i = 0; i < table.probs.length; i++) {
    if (!gateAllows(table, i, ownedCounts)) continue
    miss *= 1 - table.probs[i]!
  }
  if (table.rolls.kind === 'chance') return table.rolls.p * (1 - miss)
  return 1 - miss ** table.rolls.n
}

/**
 * Analytic expected value per kill — no sampling. This is what the `ev_matches`
 * validation check compares the wiki's stated average kill value against, and
 * what the UI shows next to observed rates.
 */
export function expectedValue(
  boss: Boss,
  ctx: SimContext,
  options: ExpectedValueOptions = {}
): ExpectedValueResult {
  const compiled = compileBoss(boss, ctx, options)
  const prices = options.prices ?? NO_PRICES
  const drops = new Float64Array(compiled.items.length)
  const quantity = new Float64Array(compiled.items.length)

  // Two triggers shrink the surviving main-drop chain, both multiplicatively
  // and both against the same `suppressedByPreroll` set of downstream modes:
  // a preroll hit, and a hit in a `suppressesFollowing` table. A table can
  // only be one or the other (the schema pins the flag to `independent`),
  // so these branches are genuinely exclusive, not a precedence question.
  let chainAlive = 1
  for (const table of compiled.tables) {
    const reach = suppressedByPreroll(table.mode) ? chainAlive : 1
    accumulateTable(table, reach, 1, 'round', compiled, drops, quantity)
    if (table.mode === 'preroll') {
      chainAlive *= 1 - prerollHitChance(table)
    } else if (table.suppressesFollowing) {
      chainAlive *= 1 - independentHitChance(table, compiled.ctx.ownedCounts)
    }
  }

  const items: ExpectedItem[] = []
  let gpPerKill = 0
  compiled.items.forEach((item, slot) => {
    const expectedQuantity = quantity[slot]!
    const gp = expectedQuantity * prices(item.itemId)
    gpPerKill += gp
    items.push({
      itemId: item.itemId,
      itemKey: item.itemKey,
      name: item.name,
      expectedDrops: drops[slot]!,
      expectedQuantity,
      gpPerKill: gp,
    })
  })

  return { items, gpPerKill }
}
