import {
  compileBoss,
  pickIndex,
  suppressedByPreroll,
  type CompiledBoss,
  type CompiledNode,
  type CompiledRolls,
  type CompiledTable,
  type CompileOptions,
} from './compile.js'
import { mulberry32, type Rng } from './rng.js'
import type { Boss, QtySpec, SimContext } from './schema.js'

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

export function rollQty(qty: QtySpec, rng: Rng): number {
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

function emit(
  node: CompiledNode,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng
): void {
  switch (node.kind) {
    case 'nothing':
      return
    case 'item': {
      const item = compiled.items[node.slot]
      if (item === undefined) throw new Error(`item slot ${node.slot} is not in the index`)
      tally.record(node.slot, rollQty(node.qty, rng), item.name, item.itemId, item.itemKey)
      return
    }
    case 'table':
      // A nested table's chain is its own; a preroll hit inside it does not
      // suppress anything in the parent.
      runTable(node.table, compiled, tally, rng)
      return
  }
}

/** Returns true when a preroll entry hit, which short-circuits the caller's chain. */
function runTable(
  table: CompiledTable,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng
): boolean {
  const rolls = rollCount(table.rolls, rng)
  let prerollHit = false

  for (let roll = 0; roll < rolls; roll++) {
    switch (table.mode) {
      case 'always': {
        for (const node of table.nodes) emit(node, compiled, tally, rng)
        break
      }
      case 'independent': {
        for (let i = 0; i < table.nodes.length; i++) {
          if (rng.nextFloat() < table.probs[i]!) emit(table.nodes[i]!, compiled, tally, rng)
        }
        break
      }
      case 'preroll': {
        for (let i = 0; i < table.nodes.length; i++) {
          if (rng.nextFloat() < table.probs[i]!) {
            emit(table.nodes[i]!, compiled, tally, rng)
            prerollHit = true
            break
          }
        }
        break
      }
      case 'weighted': {
        if (table.withoutReplacement) {
          runWeightedWithoutReplacement(table, compiled, tally, rng, rolls)
          return false
        }
        const picked = pickIndex(table.cum, rng.nextFloat() * table.denominator)
        // Past the last bucket means the implicit `nothing` remainder.
        if (picked < table.nodes.length) emit(table.nodes[picked]!, compiled, tally, rng)
        break
      }
    }
    if (prerollHit) break
  }

  return prerollHit
}

/**
 * Renormalise over the entries not yet drawn — equivalently, reroll on a
 * collision. The implicit `nothing` remainder keeps its mass throughout, since
 * it is not an entry and so cannot be removed from the pool.
 */
function runWeightedWithoutReplacement(
  table: CompiledTable,
  compiled: CompiledBoss,
  tally: Tally,
  rng: Rng,
  rolls: number
): void {
  const count = table.nodes.length
  const removed = new Uint8Array(count)
  let removedWeight = 0

  for (let roll = 0; roll < rolls; roll++) {
    const available = table.denominator - removedWeight
    if (available <= 0) return
    const r = rng.nextFloat() * available
    let acc = 0
    for (let i = 0; i < count; i++) {
      if (removed[i] === 1) continue
      acc += table.weights[i]!
      if (r < acc) {
        emit(table.nodes[i]!, compiled, tally, rng)
        removed[i] = 1
        removedWeight += table.weights[i]!
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

  for (let kill = 0; kill < n; kill++) {
    const logging = kill < logLimit
    tally.logDrops = logging ? [] : null

    let chainBroken = false
    for (const table of compiled.tables) {
      if (chainBroken && suppressedByPreroll(table.mode)) continue
      if (runTable(table, compiled, tally, rng)) chainBroken = true
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
