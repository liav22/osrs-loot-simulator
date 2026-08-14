import {
  applyQtyMultiplier,
  compileBoss,
  effectiveWeightedPool,
  ownershipGateSatisfied,
  pickIndex,
  suppressedByPreroll,
  type CompiledBoss,
  type CompiledNode,
  type CompiledRolls,
  type CompiledTable,
  type CompileOptions,
  type ResolvedQtySpec,
} from './compile.js'
import { mulberry32, type Rng } from './rng.js'
import type { Boss, QtyRounding, SimContext } from './schema.js'

/**
 * gp value of an item. `itemId` is null when the item could not be resolved
 * to a single id; a lookup has no way to price that and should return 0.
 * Prices live outside the loot model (6.1).
 */
export type PriceLookup = (itemId: number | null) => number

export interface SimOptions extends CompileOptions {
  prices?: PriceLookup
  /** Per-kill log cap. Section 8 says the first 1,000 kills. */
  logLimit?: number
}

export interface DropTally {
  itemId: number | null
  itemKey: string
  name: string
  /** Kills' worth of drops of this item — how many times it came up. */
  drops: number
  /** Total units dropped across the run. */
  quantity: number
  gp: number
}

export interface KillLogDrop {
  itemId: number | null
  itemKey: string
  name: string
  qty: number
}

export interface KillLogEntry {
  /** 1-based kill number. */
  kill: number
  drops: KillLogDrop[]
}

export interface SimResult {
  kills: number
  seed: number
  drops: DropTally[]
  gpTotal: number
  gpPerKill: number
  log: KillLogEntry[]
}

export const DEFAULT_LOG_LIMIT = 1000

const NO_PRICES: PriceLookup = () => 0

/**
 * Accumulates one run. Counts are Int32Array (a 10M-kill run cannot overflow
 * one); quantities are Float64Array because 10M kills of a 1,000-unit stack
 * comfortably exceeds 2^31.
 */
class Tally {
  readonly drops: Int32Array
  readonly quantity: Float64Array
  /** Non-null only while the current kill is being logged. */
  logDrops: KillLogDrop[] | null = null

  constructor(private readonly slots: number) {
    this.drops = new Int32Array(slots)
    this.quantity = new Float64Array(slots)
  }

  record(slot: number, qty: number, name: string, itemId: number | null, itemKey: string): void {
    this.drops[slot]! += 1
    this.quantity[slot]! += qty
    if (this.logDrops !== null) this.logDrops.push({ itemId, itemKey, name, qty })
  }

  get size(): number {
    return this.slots
  }
}

/**
 * Live, mutating ownership counts for Extension B's four sources (Duke
 * Sucellus, ToA, Lunar Chest, Reward Cart — see `OwnershipGateSchema`'s
 * comment). Starts from `ctx.ownedCounts` and is updated after each item
 * emission that matches a tracked `itemKey`, so a kill partway through a
 * large batch can see an item a prior kill in the SAME batch obtained.
 *
 * Mutation happens exactly once per emission, driven entirely by the
 * outcome of the same seeded RNG stream that decided the emission — never a
 * second, independent source of randomness — so "same seed + same input ⇒
 * same output" (section 8) holds for the whole run, not just within one
 * kill. `simulate.test.ts`'s Extension B suite asserts this directly (same
 * seed run twice produces byte-identical tallies and logs), not just by
 * this reasoning.
 */
class OwnershipTracker {
  private readonly counts = new Map<string, number>()

  constructor(initial: Readonly<Record<string, number>>) {
    for (const [itemKey, count] of Object.entries(initial)) this.counts.set(itemKey, count)
  }

  get(itemKey: string): number {
    return this.counts.get(itemKey) ?? 0
  }

  add(itemKey: string, qty: number): void {
    if (qty === 0) return
    this.counts.set(itemKey, this.get(itemKey) + qty)
  }
}

export function rollQty(qty: ResolvedQtySpec, rng: Rng): number {
  switch (qty.kind) {
    case 'exact':
      return qty.n
    case 'range':
      return qty.min + rng.nextInt(qty.max - qty.min + 1)
    case 'choice': {
      const value = qty.values[rng.nextInt(qty.values.length)]
      if (value === undefined) throw new Error('choice qty had no values')
      return value
    }
  }
}

function rollCount(rolls: CompiledRolls, rng: Rng): number {
  if (rolls.kind === 'count') return rolls.n
  return rng.nextFloat() < rolls.p ? 1 : 0
}

/**
 * `qtyMultiplier` is the product of every `Table`/`TableRefNode` multiplier
 * on the path from the boss's top-level `tables` array down to this specific
 * emission — composed by multiplying in as each level is entered, applied
 * once at the `item` leaf. 1 for every source that doesn't use the feature,
 * so this is a no-op multiply on the hot path rather than a skipped branch;
 * see docs/mechanics-model-proposal.md's benchmark note.
 *
 * `owned` is the run's `OwnershipTracker`, always a real (possibly empty)
 * instance — see that class's comment for why threading a live object
 * through here, rather than branching on `null`, keeps this function simple
 * without giving up the fast path (`compiled.trackedItemKeys` is empty for
 * every source that doesn't use Extension B, so the `.has()` check below is
 * the only cost paid, same as any other `Set` lookup).
 */
function emit(
  node: CompiledNode,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng,
  qtyMultiplier: number,
  qtyRounding: QtyRounding,
  owned: OwnershipTracker
): void {
  switch (node.kind) {
    case 'nothing':
      return
    case 'item': {
      const item = compiled.items[node.slot]
      if (item === undefined) throw new Error(`item slot ${node.slot} is not in the index`)
      const rolled = rollQty(node.qty, rng)
      // Skip the multiply-and-round for the overwhelming majority of
      // emissions (every source that doesn't use qtyMultiplier) rather than
      // pay for a no-op `Math.round(x * 1)` on the hot path — measured to
      // matter: see docs/mechanics-model-proposal.md's benchmark note.
      const qty =
        qtyMultiplier === 1 ? rolled : applyQtyMultiplier(rolled, qtyMultiplier, qtyRounding)
      tally.record(node.slot, qty, item.name, item.itemId, item.itemKey)
      // `.size` short-circuits the `.has()` lookup for every source that
      // doesn't use Extension B (an empty Set) without relying on V8 to
      // optimize an unconditional `.has()` call on its own.
      if (compiled.trackedItemKeys.size > 0 && compiled.trackedItemKeys.has(item.itemKey)) {
        owned.add(item.itemKey, qty)
      }
      return
    }
    case 'table': {
      // A nested table's chain is its own; a hit inside it — preroll or
      // `suppressesFollowing` — does not suppress anything in the parent,
      // which is why `runTable`'s return value is discarded here.
      const nested = qtyMultiplier * node.qtyMultiplier
      // Most-specific-wins: an access that states its own rounding overrides
      // whatever the enclosing path used. No source nests two multipliers
      // today, so this is a rule stated once rather than one under load.
      const nestedRounding = node.qtyRounding === 'round' ? qtyRounding : node.qtyRounding
      // `drawsPerHit` is 1 for every source but Corporeal Beast, so the
      // common case is one pass through a loop whose bound is a plain
      // property read — no branch to predict, nothing allocated.
      for (let draw = 0; draw < node.drawsPerHit; draw++) {
        runTable(node.table, compiled, tally, rng, nested, nestedRounding, owned)
      }
      return
    }
  }
}

/** Whether entry `i`'s ownership gate (if any) currently permits it. `table.ownershipGates === null` is the fast path every non-Extension-B table takes — checked once per table, not once per entry. */
function gateAllows(table: CompiledTable, i: number, owned: OwnershipTracker): boolean {
  if (table.ownershipGates === null) return true
  const gate = table.ownershipGates[i] ?? null
  return gate === null || ownershipGateSatisfied(gate, owned.get(gate.itemKey))
}

/**
 * Returns true when this table ended the main-drop chain for the rest of the
 * document — either a `preroll` entry hit (4.3), or any entry of a
 * `suppressesFollowing` table hit (CoX's unique table). The two are tracked
 * separately below because they differ in what they do to THIS table's own
 * remaining rolls: a preroll hit stops them, a `suppressesFollowing` hit
 * doesn't (it only ends the chain downstream — CoX awards up to six uniques,
 * so a hit must not stop its own table).
 */
function runTable(
  table: CompiledTable,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng,
  qtyMultiplier: number,
  qtyRounding: QtyRounding,
  owned: OwnershipTracker
): boolean {
  const effectiveQty = qtyMultiplier * table.qtyMultiplier
  const effectiveRounding = table.qtyRounding === 'round' ? qtyRounding : table.qtyRounding
  const rolls = rollCount(table.rolls, rng)
  let prerollHit = false
  let suppressHit = false

  // Hoisted once per table-roll, not re-checked per entry: every table
  // without Extension B gates (still every table in the 36 sources verified
  // before it existed) takes the exact original loop body below, with zero
  // added per-entry cost — not even a `gateAllows` call. Splitting the loop
  // rather than branching inside it is the same trade as `qtyMultiplier`'s
  // `=== 1` fast path in Extension A: duplicated code, but nothing extra on
  // the hot path for sources that don't use the feature.
  const gated = table.ownershipGates !== null

  for (let roll = 0; roll < rolls; roll++) {
    switch (table.mode) {
      case 'always': {
        for (let i = 0; i < table.nodes.length; i++) {
          if (gated && !gateAllows(table, i, owned)) continue
          emit(table.nodes[i]!, compiled, tally, rng, effectiveQty, effectiveRounding, owned)
        }
        break
      }
      case 'independent': {
        for (let i = 0; i < table.nodes.length; i++) {
          if (gated && !gateAllows(table, i, owned)) continue
          if (rng.nextFloat() < table.probs[i]!) {
            emit(table.nodes[i]!, compiled, tally, rng, effectiveQty, effectiveRounding, owned)
            // Deliberately no `break`: every remaining entry still rolls.
            // The flag is read here, on a hit, rather than hoisted per
            // table-roll like `gated` below — an independent entry hitting is
            // rare (tertiary rates are 1/15 and rarer), so this costs a
            // property read on ~1 in 15 rolls instead of on every one.
            // Measured: hoisting it cost ~3% on Brutus, which uses no flag.
            if (table.suppressesFollowing) suppressHit = true
          }
        }
        break
      }
      case 'preroll': {
        for (let i = 0; i < table.nodes.length; i++) {
          if (gated && !gateAllows(table, i, owned)) continue
          if (rng.nextFloat() < table.probs[i]!) {
            emit(table.nodes[i]!, compiled, tally, rng, effectiveQty, effectiveRounding, owned)
            prerollHit = true
            break
          }
        }
        break
      }
      case 'weighted': {
        // Every table without Extension B gates (which, before Extension B,
        // was *every* table) takes the `if` branch below: no
        // `effectiveWeightedPool` call, no closure, no wrapper object —
        // `weights`/`cum`/`denominator` are read straight off the compiled
        // table, exactly as before this feature existed. Measured to
        // matter: an earlier version called `effectiveWeightedPool`
        // unconditionally (cheap inside, but the call itself allocated a
        // closure and a result object on every weighted-table roll) and
        // cost ~25% on Brutus, which uses none of this — see
        // docs/mechanics-model-proposal.md's benchmark note.
        let weights: Float64Array
        let cum: Float64Array
        let denominator: number
        if (table.ownershipGates === null) {
          weights = table.weights
          cum = table.cum
          denominator = table.denominator
        } else {
          const pool = effectiveWeightedPool(table, (itemKey) => owned.get(itemKey))
          weights = pool.weights
          cum = pool.cum
          denominator = pool.denominator
        }
        if (table.withoutReplacement) {
          runWeightedWithoutReplacement(
            table,
            weights,
            denominator,
            compiled,
            tally,
            rng,
            rolls,
            effectiveQty,
            effectiveRounding,
            owned
          )
          return false
        }
        // Every entry ownership-excluded (e.g. a fully-owned Lunar Chest set)
        // leaves nothing to draw from; clamp rather than risk `pickIndex`
        // seeing a negative target from float rounding on a ~0 denominator.
        const picked =
          denominator <= 0 ? table.nodes.length : pickIndex(cum, rng.nextFloat() * denominator)
        // Past the last bucket means the implicit `nothing` remainder.
        if (picked < table.nodes.length) {
          emit(table.nodes[picked]!, compiled, tally, rng, effectiveQty, effectiveRounding, owned)
        }
        break
      }
    }
    if (prerollHit) break
  }

  return prerollHit || suppressHit
}

/**
 * Renormalise over the entries not yet drawn — equivalently, reroll on a
 * collision. The implicit `nothing` remainder keeps its mass throughout, since
 * it is not an entry and so cannot be removed from the pool.
 *
 * `weights`/`denominator` are the table's own (no Extension B gates), or the
 * ownership-adjusted ones from `effectiveWeightedPool` (Lunar Chest's
 * per-set duplicate protection: already-owned pieces arrive here with
 * weight 0 and a correspondingly shrunk `denominator`, on top of — not
 * instead of — the `removed`/`removedWeight` tracking below, which still
 * does its own job of not repeating a pick within THIS roll sequence).
 * Taken as plain parameters rather than a wrapper object so the caller's
 * fast (no-gates) path never allocates one — see `runTable`'s comment.
 */
function runWeightedWithoutReplacement(
  table: CompiledTable,
  weights: Float64Array,
  denominator: number,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng,
  rolls: number,
  qtyMultiplier: number,
  qtyRounding: QtyRounding,
  owned: OwnershipTracker
): void {
  const count = table.nodes.length
  const removed = new Uint8Array(count)
  let removedWeight = 0

  for (let roll = 0; roll < rolls; roll++) {
    const available = denominator - removedWeight
    if (available <= 0) return
    const r = rng.nextFloat() * available
    let acc = 0
    for (let i = 0; i < count; i++) {
      if (removed[i] === 1) continue
      acc += weights[i]!
      if (r < acc) {
        emit(table.nodes[i]!, compiled, tally, rng, qtyMultiplier, qtyRounding, owned)
        removed[i] = 1
        removedWeight += weights[i]!
        break
      }
    }
    // Falling through the loop means the remainder was hit: nothing, and the
    // pool is unchanged.
  }
}

export function simulate(
  boss: Boss,
  n: number,
  ctx: SimContext,
  seed: number,
  options: SimOptions = {}
): SimResult {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`kill count must be a non-negative integer, got ${n}`)
  }

  const compiled = compileBoss(boss, ctx, options)
  const prices = options.prices ?? NO_PRICES
  const logLimit = options.logLimit ?? DEFAULT_LOG_LIMIT
  const rng = mulberry32(seed)
  const tally = new Tally(compiled.items.length)
  const log: KillLogEntry[] = []
  // Starts from ctx.ownedCounts and persists — not reset — for the whole
  // run, across all n kills; see OwnershipTracker's comment.
  const owned = new OwnershipTracker(ctx.ownedCounts)

  for (let kill = 0; kill < n; kill++) {
    const logging = kill < logLimit
    tally.logDrops = logging ? [] : null

    let chainBroken = false
    for (const table of compiled.tables) {
      if (chainBroken && suppressedByPreroll(table.mode)) continue
      if (runTable(table, compiled, tally, rng, 1, 'round', owned)) chainBroken = true
    }

    if (logging && tally.logDrops !== null) {
      log.push({ kill: kill + 1, drops: tally.logDrops })
    }
  }
  tally.logDrops = null

  const drops: DropTally[] = []
  let gpTotal = 0
  for (let slot = 0; slot < tally.size; slot++) {
    const item = compiled.items[slot]!
    const quantity = tally.quantity[slot]!
    const gp = quantity * prices(item.itemId)
    gpTotal += gp
    drops.push({
      itemId: item.itemId,
      itemKey: item.itemKey,
      name: item.name,
      drops: tally.drops[slot]!,
      quantity,
      gp,
    })
  }

  return {
    kills: n,
    seed,
    drops,
    gpTotal,
    gpPerKill: n === 0 ? 0 : gpTotal / n,
    log,
  }
}
