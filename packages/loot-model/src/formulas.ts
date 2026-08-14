import type { FormulaId, Rate, SimContext, SimContextField } from './schema.js'
import { FORMULA_IDS } from './schema.js'

/** Returns a probability in [0, 1]. */
export type FormulaFn = (params: Record<string, unknown>, ctx: SimContext) => number

export type FormulaRegistry = ReadonlyMap<FormulaId, FormulaFn>

export class FormulaNotImplementedError extends Error {
  constructor(readonly formulaId: FormulaId) {
    super(
      `Formula '${formulaId}' is declared but not implemented yet. ` +
        `Real implementations land in Phase 5; pass a registry override to supply one now.`
    )
    this.name = 'FormulaNotImplementedError'
  }
}

export class UnknownFormulaError extends Error {
  constructor(readonly formulaId: string) {
    super(`Unknown formula '${formulaId}'`)
    this.name = 'UnknownFormulaError'
  }
}

/**
 * Phase 1 registers every id from section 4.6 with a stub that throws.
 * Throwing beats returning 0: a silent zero would sail through the `ev_matches`
 * validation check and ship a boss that drops nothing.
 */
function stubFormula(formulaId: FormulaId): FormulaFn {
  return () => {
    throw new FormulaNotImplementedError(formulaId)
  }
}

/**
 * Zalcano's two eligibility thresholds, stated in the first line of its
 * `==Drops==` section: "Players must do at least 5 damage to Zalcano's shield
 * to be eligible for drops, and 31 combined damage to be eligible for uniques
 * and pet." Named here so `zalcano_crystal_shards` and the boss document's
 * `levelAtLeast` conditions cannot drift apart silently — they are two
 * expressions of one wiki sentence.
 */
export const ZALCANO_DROP_ELIGIBILITY_SHIELD_DAMAGE = 5
export const ZALCANO_UNIQUE_ELIGIBILITY_TOTAL_DAMAGE = 31

/**
 * Real implementations, keyed by id. Everything absent here is still a stub
 * that throws — see `stubFormula`. A formula lands here only once the wiki
 * states its rule outright; a curve that is UNKNOWN on the page stays a stub
 * rather than becoming a guess with a plausible shape.
 */
const IMPLEMENTED: Partial<Record<FormulaId, FormulaFn>> = {
  /**
   * One roll of the ">8" loot row per deep-delve level.
   *
   * Doom of Mokhaiotl's Mechanics section: "Each delve level rolls once on the
   * regular loot table", and its per-level table's deepest row is ">8" while
   * descent continues indefinitely ("After clearing delve 8, the player is
   * awarded a 'deep delve' count, and players can continue descending"). So a
   * run ending at delve 12 rolls levels 1-8 at their own multipliers and the
   * ">8" row four more times. Consumed as an integer count via
   * `Table.rolls`, not as a probability.
   */
  doom_of_mokhaiotl_deep_rolls: (_params, ctx) => Math.max(0, ctx.delveLevel - 8),

  /**
   * 1 / 3 / 6 standard-loot rolls for 1 / 2 / 3 Moons killed. "The multiplier
   * is 3x per additional Moon, not additive" (Lunar Chest, ==Loot mechanics==,
   * revid 15284737) — so 3 Moons is 6, not 9 and not 3+3. Zero Moons cannot
   * open the chest at all, which the 0 case reflects. Consumed as an integer
   * count via `Table.rolls`.
   */
  lunar_chest_standard_rolls: (_params, ctx) =>
    [0, 1, 3, 6][Math.min(ctx.moonsKilled.length, 3)] ?? 0,

  /**
   * Crystal shards, as a discrete tier keyed by the player's role — not a
   * quantity range. Zalcano's `===100%===` section, citing Mod Husky
   * (10 March 2020): "1 Shard - Player eligible for a drop / 2 Shards - Player
   * eligible for uniques/pet / 3 Shards - Player is the MVP", restated in the
   * page's own prose. The `quantity=1-3` in the drop row is the observed span
   * of those three tiers, not a uniform roll over them.
   *
   * The thresholds are the page's two eligibility gates: ">= 5 damage to
   * Zalcano's shield to be eligible for drops, and 31 combined damage to be
   * eligible for uniques and pet". Consumed as a quantity via `QtySpec`.
   */
  zalcano_crystal_shards: (_params, ctx) => {
    if (ctx.shieldDamage < ZALCANO_DROP_ELIGIBILITY_SHIELD_DAMAGE) return 0
    if (ctx.isMVP) return 3
    return ctx.totalDamage >= ZALCANO_UNIQUE_ELIGIBILITY_TOTAL_DAMAGE ? 2 : 1
  },

  /**
   * The MVP's share of their own non-unique loot: "The MVP, the player who
   * deals the most damage to Zalcano, will also receive an additional 10%
   * (rounded up) of their non-unique loot." Consumed as a `Table.qtyMultiplier`
   * paired with `qtyRounding: 'ceilDelta'`, which is the field that exists
   * precisely to express the page's "(rounded up)" — the rounding applies to
   * the 10% delta, not to the product.
   */
  zalcano_mvp_share: (_params, ctx) => (ctx.isMVP ? 1.1 : 1),

  /**
   * "Infernal ashes are only dropped for the MVP." A role, not a rate: always
   * for one player, never for anyone else. Consumed as a `formula`-kind `Rate`
   * on an `independent` entry, where a probability of exactly 1 or 0 is the
   * degenerate Bernoulli case the mode already handles — the same reasoning
   * that admitted `always` rates into `independent` mode (see
   * docs/DECISIONS.md). This needs no boolean-field `Condition` kind, which is
   * why none was added.
   */
  zalcano_mvp_only: (_params, ctx) => (ctx.isMVP ? 1 : 0),
}

/**
 * Ids with a real implementation above. Exported so the trip-wire test in
 * `formulas.test.ts` can assert "every id that is NOT implemented still
 * throws" — the guard against a stub quietly becoming a silent zero — rather
 * than the now-false "every id throws", which is what that test asserted for
 * as long as the registry was entirely stubs.
 */
export const IMPLEMENTED_FORMULA_IDS: ReadonlySet<FormulaId> = new Set(
  Object.keys(IMPLEMENTED) as FormulaId[]
)

/**
 * Which `SimContext` fields each formula reads.
 *
 * This exists because a boss document does not reveal it. A UI can discover
 * that a boss gates on `delveLevel` by walking its `levelAtLeast` conditions,
 * but Zalcano's `isMVP` is read *only* inside `zalcano_mvp_share` and
 * `zalcano_mvp_only` — invisible in the document, and therefore an
 * unreachable control, which is exactly the class of bug that left Doom of
 * Mokhaiotl and Lunar Chest shipped-but-unusable. Declaring it here keeps the
 * knowledge next to the implementation that owns it.
 *
 * Every `FormulaId` must appear, so adding one forces a decision rather than
 * defaulting to "reads nothing". Unimplemented stubs declare `[]`: they read
 * nothing because they do nothing yet, and the entry becomes real when the
 * implementation does.
 *
 * `formulas.test.ts` verifies these declarations *behaviourally* — for every
 * implemented formula it varies each undeclared field and asserts the output
 * does not move — so a declaration cannot silently drift from the code.
 */
export const FORMULA_CONTEXT_FIELDS: Record<FormulaId, readonly SimContextField[]> = {
  toa_invocation: [],
  cox_points: [],
  tob_points: [],
  barrows_kc: [],
  wintertodt_points: [],
  tempoross_points: [],
  wilderness_slayer: [],
  zalcano_points: [],
  doom_of_mokhaiotl_uniques: [],
  doom_of_mokhaiotl_qty: [],
  fortis_colosseum_uniques: [],
  fortis_colosseum_qty: [],
  tzhaar_fight_cave_tokkul: [],
  duke_sucellus_ice_quartz: [],
  zalcano_crystal_shards: ['shieldDamage', 'totalDamage', 'isMVP'],
  zalcano_mvp_share: ['isMVP'],
  zalcano_mvp_only: ['isMVP'],
  doom_of_mokhaiotl_deep_rolls: ['delveLevel'],
  lunar_chest_standard_rolls: ['moonsKilled'],
}

export function createFormulaRegistry(
  overrides: Partial<Record<FormulaId, FormulaFn>> = {}
): FormulaRegistry {
  const registry = new Map<FormulaId, FormulaFn>()
  for (const formulaId of FORMULA_IDS) {
    registry.set(
      formulaId,
      overrides[formulaId] ?? IMPLEMENTED[formulaId] ?? stubFormula(formulaId)
    )
  }
  return registry
}

export const defaultFormulaRegistry: FormulaRegistry = createFormulaRegistry()

function callFormula(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry
): number {
  const fn = registry.get(formulaId)
  if (fn === undefined) throw new UnknownFormulaError(formulaId)
  return fn(params, ctx)
}

/**
 * `[0, 1]`-probability contract — a formula used as a `Rate`. Kept under its
 * original name since it's part of the tested public API (see
 * `formulas.test.ts`); `evaluateQuantity`/`evaluateMultiplier` below are the
 * other two contracts a formula id can fulfil, added for the `QtySpec`,
 * `Table.rolls`, and `qtyMultiplier` formula variants. Which contract a given
 * formula id fulfils is a property of where it's used, not of `FormulaFn`'s
 * type — documented at each formula's registration site, not enforced by the
 * type system.
 */
export function evaluateFormula(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const probability = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError(`Formula '${formulaId}' returned ${probability}, expected [0, 1]`)
  }
  return probability
}

/**
 * Non-negative-quantity contract — a formula used as a `QtySpec` or as
 * `Table.rolls`' integer-count variant. Rounds to the nearest integer, since
 * every other `QtySpec`/`rolls` shape is integer-valued; a formula that needs
 * `trunc`-toward-zero behaviour (e.g. Doom of Mokhaiotl's per-level quantity
 * multiplier) does that internally before returning, making this rounding a
 * no-op for it.
 */
export function evaluateQuantity(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const value = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Formula '${formulaId}' returned ${value}, expected a non-negative quantity`)
  }
  return Math.round(value)
}

/**
 * Positive-multiplier contract — a formula used as `qtyMultiplier` on a
 * `Table` or `TableRefNode`. No upper bound (Duke Sucellus' +50% is 1.5,
 * Abyssal Sire's flat double is 2), and not rounded — a multiplier need not
 * be integer-valued.
 */
export function evaluateMultiplier(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const value = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Formula '${formulaId}' returned ${value}, expected a positive multiplier`)
  }
  return value
}

/**
 * Absolute probability of a rate. `weight` rates have no absolute probability
 * on their own — they are a share of the parent table's denominator — so they
 * are rejected here rather than silently coerced.
 */
export function rateToProbability(
  rate: Rate,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  switch (rate.kind) {
    case 'always':
      return 1
    case 'fixed':
      return rate.num / rate.den
    case 'formula':
      return evaluateFormula(rate.id, rate.params, ctx, registry)
    case 'weight':
      throw new TypeError(
        'weight rates are relative to a table denominator and have no standalone probability'
      )
  }
}
