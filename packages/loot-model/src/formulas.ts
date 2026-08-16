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

// ---------------------------------------------------------------------------
// Theatre of Blood
//
// One source, `Module:Theatre of Blood calculator` — the page's own prose
// never states a points formula at all (confirmed by direct search of the
// wikitext: zero occurrences of "point"/"MVP"/"skip"), only the fact that a
// raid can end at 0 points ("Only obtained if a player ends the raid with 0
// individual contribution points", cited on the Cabbage/Message rows). The
// module states the rule the prose only gestures at — the same "missing
// source, not missing fact" shape as ToA's interpolation rule and CoX's
// common-quantity divisors. See docs/bosses/monumental-chest.md.
// ---------------------------------------------------------------------------

/** `tobPoints`'s own maximum (see `conditions.ts`'s `tobPointsFor`), i.e. `ratio = tobPoints / TOB_MAX_POINTS`. */
export const TOB_MAX_POINTS = 32

/**
 * Hard Mode's common-table quantity multiplier: **flat 1.30 with the time
 * bonus, not 1.15 squared.** The page's own prose ("+15%, another +15% if
 * completed within the target time") reads as compounding
 * (1.15 x 1.15 = 1.3225); the module's `qmult = (args.timebonus == 'true')
 * and 1.30 or 1.15` is a flat total. The module wins — the failure mode this
 * project has hit before is trusting a continuous/compounding reading of a
 * prose percentage over the module's own stepped/flat arithmetic (ToA's
 * `toaCommonQtyScale` stepped-vs-continuous entry is the same lesson).
 */
export const TOB_HARD_MODE_QTY_MULTIPLIER = 1.15
export const TOB_HARD_MODE_TIME_BONUS_QTY_MULTIPLIER = 1.3
/**
 * Entry Mode's common-table quantity: a flat -80%, from page prose alone (the
 * calculator has no Entry Mode option at all, so nothing confirms whether
 * this composes with the points ratio the way Normal/Hard do). Applied as a
 * constant, NOT scaled by `tobPoints` — deliberately, since there is no
 * source either way and inventing a composition would be exactly the kind of
 * guessed curve this project declines to ship. See `tob_common_qty`.
 */
export const TOB_ENTRY_MODE_QTY_MULTIPLIER = 0.2

// ---------------------------------------------------------------------------
// Chambers of Xeric (Ancient chest)
//
// Two sources: `Ancient chest`'s own prose states the unique-roll rule
// (1%-per-8,676-points, 65.7% cap, up to 6 rolls, 131,071-point common-loot
// cap) and the per-item weight/divisor tables are NOT stated on the page at
// all — `Module:Chambers of Xeric calculator` is the only source for those
// (same "missing source, not missing fact" shape as ToA/ToB). Where the two
// disagree, see the specific notes below; both are cited per constant.
// ---------------------------------------------------------------------------

/** Points consumed per unique-roll "chunk", and the resulting per-chunk chance denominator. */
export const COX_UNIQUE_ROLL_CHUNK_POINTS = 570_000
/**
 * The module's own per-1%-points constant, `8675` — the page's prose states
 * `8,676`. Both round to the same published "65.7%" cap
 * (`570,000/867,500 = 65.6926%`, `570,000/867,600 = 65.6754%`), so no cited
 * figure on the page distinguishes them; the module's number is used since it
 * is what the live calculator actually computes. See
 * `docs/bosses/ancient-chest.md`.
 */
export const COX_UNIQUE_ROLL_DIVISOR = 867_500
export const COX_MAX_UNIQUE_ROLLS = 6
/** "the two rolls cannot end on the same drop" — Ancient chest, `===Common drop table===`. */
export const COX_ELITE_CLUE_RATE = { num: 1, den: 12 } as const
export const COX_OLMLET_RATE = { num: 1, den: 53 } as const
/**
 * "Common-loot scaling caps at 131,071 points" (page prose). The module's own
 * `trashItems` divisor loop has no such cap at all — the same asymmetry as
 * ToA's elite-clue cap, where a cited primary source states a ceiling the
 * calculator's simplified arithmetic omits. Verified against the page's own
 * published quantity ranges: 26 of 29 checked items' stated upper bound is
 * EXACTLY `floor(131071 / divisor)` (three — Grimy avantoe/kwuarm/lantadyme —
 * are off by exactly 1, a display-rounding discrepancy too small to change
 * which cap is being applied). The cited prose figure wins, per this
 * project's established practice.
 */
export const COX_COMMON_QTY_POINTS_CAP = 131_071

/** One unique-roll "chunk"'s own chance: `chunk_n_points / COX_UNIQUE_ROLL_DIVISOR`, naturally capped since a chunk never exceeds `COX_UNIQUE_ROLL_CHUNK_POINTS`. */
function coxRollChance(points: number, rollIndex: number): number {
  const consumedBefore = (rollIndex - 1) * COX_UNIQUE_ROLL_CHUNK_POINTS
  const chunkPoints = Math.min(
    COX_UNIQUE_ROLL_CHUNK_POINTS,
    Math.max(0, points - consumedBefore)
  )
  return chunkPoints / COX_UNIQUE_ROLL_DIVISOR
}

/**
 * P(at least one unique this raid) — every one of the up to 6 rolls is an
 * independent Bernoulli trial (`docs/bosses/ancient-chest.md`: "each an
 * independent roll against its own points remainder"), so this is
 * `1 - Π(1 - P(roll_n))`, not a first-hit-wins chain. Needed for the elite
 * clue / Olmlet tertiary entries, which condition on this fact rather than on
 * any single roll.
 */
function coxAnyUniqueProbability(points: number): number {
  let survival = 1
  for (let rollIndex = 1; rollIndex <= COX_MAX_UNIQUE_ROLLS; rollIndex++) {
    survival *= 1 - coxRollChance(points, rollIndex)
  }
  return 1 - survival
}

// ---------------------------------------------------------------------------
// Tombs of Amascut
//
// Two sources, and it matters which states what:
//
//  - `Chest (Tombs of Amascut)` states every RULE in prose, with cited news
//    posts and Mod Ash tweets: the 1%-per-N-points unique chance, the 55% cap,
//    the 5,000-point subtraction, the bad-luck curve, the 25% clue cap.
//  - `Module:Tombs of Amascut loot` — the Lua behind the page's own
//    `{{Calculator:Tombs of Amascut loot}}` — states the ARITHMETIC the prose
//    gives only continuously: integer unique weights, and `math.floor` at each
//    step. The page's own weight table is 5 breakpoints; the module is the
//    rule that generates them, verified below.
//
// Where they differ, the difference is always flooring, and the module is
// what the wiki's own calculator computes. Both are cited per constant.
// ---------------------------------------------------------------------------

/**
 * The 7-unique pool's base weights and the raid level each item unlocks at,
 * from `Module:Tombs of Amascut loot`'s `PURPLES` table.
 *
 * These integers are not a reconstruction: the module states them directly,
 * and they independently reproduce all five rows of the page's own published
 * weight table exactly (e.g. at raid level 400 the weights are fang 40,
 * lightbearer 50, ward 30, masori 20 each, shadow 10, summing to 190 — giving
 * 1/4.75, 1/3.8, 1/6.33, 1/9.5 and 1/19, which is that row verbatim).
 * `toa.test.ts` pins that agreement against the wiki's figures.
 *
 * `level` is the raid level below which the item is out of invocation range,
 * where the page's "additional 1/50 roll" applies.
 */
export const TOA_UNIQUES = {
  'tumeken-s-shadow-uncharged': { weight: 10, level: 150 },
  'masori-mask': { weight: 20, level: 150 },
  'masori-body': { weight: 20, level: 150 },
  'masori-chaps': { weight: 20, level: 150 },
  'elidinis-ward': { weight: 30, level: 150 },
  'osmumten-s-fang': { weight: 70, level: 50 },
  lightbearer: { weight: 70, level: 50 },
} as const satisfies Record<string, { weight: number; level: number }>

export type ToaUnique = keyof typeof TOA_UNIQUES

/** The divisor applied to an out-of-invocation-range unique's weight. */
export const TOA_OUT_OF_RANGE_DIVISOR = 50

/** The page's stated ceiling on the unique chance: "a maximum of 55%". */
export const TOA_UNIQUE_RATE_CAP = 0.55

/** "up to a maximum of 25%" (Mod Ash, 6 March 2024, cited on the page). */
export const TOA_ELITE_CLUE_RATE_CAP = 0.25
export const TOA_ELITE_CLUE_DENOMINATOR = 200_000

/** Below this many points a raid yields fossilised dung and nothing else. */
export const TOA_DUNG_GATE_POINTS = 1500

/**
 * Integer-exact `floor(n * numerator / denominator)`.
 *
 * The module writes these as `math.floor((raid_level - 450) * 0.2)`, and
 * multiplying by 0.2/0.4/0.1 in IEEE doubles is exactly the trap
 * `compile.ts`'s `scaledDelta` documents: the product can land a whisker below
 * an integer and `floor` then loses a whole weight unit. Doing the multiply in
 * integers first and dividing once is exact for every raid level in range.
 */
function floorScaled(value: number, numerator: number, denominator: number): number {
  return Math.floor((value * numerator) / denominator)
}

/**
 * Osmumten's fang and the Lightbearer at a given raid level; every other
 * unique's weight is constant. `Module:Tombs of Amascut loot`'s `p.reweight`,
 * transcribed branch for branch.
 */
export function toaReweightedUniques(raidLevel: number): { fang: number; lightbearer: number } {
  if (raidLevel <= 300) return { fang: 70, lightbearer: 70 }
  if (raidLevel >= 500) return { fang: 30, lightbearer: 35 }
  if (raidLevel >= 450) {
    return {
      fang: 40 - floorScaled(raidLevel - 450, 2, 10),
      lightbearer: 40 - floorScaled(raidLevel - 450, 1, 10),
    }
  }
  if (raidLevel >= 400) {
    return { fang: 40, lightbearer: 50 - floorScaled(raidLevel - 400, 2, 10) }
  }
  if (raidLevel >= 350) {
    return {
      fang: 60 - floorScaled(raidLevel - 350, 4, 10),
      lightbearer: 60 - floorScaled(raidLevel - 350, 2, 10),
    }
  }
  return {
    fang: 70 - floorScaled(raidLevel - 300, 2, 10),
    lightbearer: 70 - floorScaled(raidLevel - 300, 2, 10),
  }
}

/** One unique's weight at this raid level, before the out-of-range divisor. */
function toaRawWeight(unique: ToaUnique, raidLevel: number): number {
  if (unique === 'osmumten-s-fang') return toaReweightedUniques(raidLevel).fang
  if (unique === 'lightbearer') return toaReweightedUniques(raidLevel).lightbearer
  return TOA_UNIQUES[unique].weight
}

/**
 * One unique's weight AFTER the out-of-range divisor — the value the `oneOf`
 * pool actually uses.
 *
 * The module applies the 1/50 to the item's own resolved rate
 * (`if raid_level < v.level then true_rate = true_rate / 50`), not to the
 * weight. Folding it into the weight is equivalent given how the pool is
 * composed, and is what lets a `oneOf` express the whole mechanic: see
 * `toaUniqueRate` for the identity that makes the two agree.
 */
export function toaUniqueWeight(unique: ToaUnique, raidLevel: number): number {
  const raw = toaRawWeight(unique, raidLevel)
  return raidLevel < TOA_UNIQUES[unique].level ? raw / TOA_OUT_OF_RANGE_DIVISOR : raw
}

/** The scaled raid level driving the unique chance. Module `p.get_rewards`. */
export function toaAdjustedRaidLevel(raidLevel: number): number {
  let adjusted = raidLevel
  if (adjusted > 310) {
    if (adjusted > 430) adjusted = 430 + Math.floor((adjusted - 430) / 2)
    adjusted = 310 + Math.floor((adjusted - 310) / 3)
  }
  return adjusted
}

/** The scaled raid level driving the pet chance. Module `p.get_rewards`. */
export function toaAdjustedRaidLevelPet(raidLevel: number): number {
  if (raidLevel <= 400) return raidLevel
  if (raidLevel > 550) return 450
  return 400 + Math.floor((raidLevel - 400) / 3)
}

/**
 * The raid's TOTAL chance of a unique — the probability the `oneOf` pool is
 * entered at all.
 *
 * The module computes a per-item rate and sums it:
 *   `P(item i) = base * w_i / W`, divided by 50 when out of range,
 *   `P(unique) = Σ_i P(item i)`.
 *
 * A `preroll` entry whose node is a `oneOf` computes
 * `P(item i) = R * v_i / Σ_j v_j`. Setting `v_i = w_i * f_i` (the divisor
 * folded into the weight) and `R = base * Σ_j w_j f_j / W` makes the two
 * identical term by term, since the `Σ v_j` cancels. That identity is why the
 * out-of-range rule needs no machinery beyond a formula-valued weight — and
 * why it must not be modelled as independent per-item rolls, which would let
 * two uniques land in one raid roughly 12% of the time a unique is awarded.
 *
 * For every raid level at or above 150 each `f_i` is 1, so `R` is simply
 * `base` and this whole correction is inert — which is the common case.
 */
export function toaUniqueRate(points: number, raidLevel: number): number {
  const denominator = 100 * (10_500 - 20 * toaAdjustedRaidLevel(raidLevel))
  // The module clamps the denominator at 150,000 ("caps at 1500"). Inert for
  // every raid level the game allows — it would bind only above raid level
  // ~450 on the ADJUSTED scale, which caps around 378 — but transcribed rather
  // than dropped, so this stays a transcription of the module and not an
  // edited version of it.
  const base = Math.min(points / Math.max(denominator, 150_000), TOA_UNIQUE_RATE_CAP)

  let raw = 0
  let adjusted = 0
  for (const unique of Object.keys(TOA_UNIQUES) as ToaUnique[]) {
    raw += toaRawWeight(unique, raidLevel)
    adjusted += toaUniqueWeight(unique, raidLevel)
  }
  return raw === 0 ? 0 : base * (adjusted / raw)
}

/**
 * The common table's per-item quantity multiplier.
 *
 * `Module:Tombs of Amascut loot`, and note the FLOOR: the page writes
 * `1.15 + 0.01*(RaidLevel-300)/5`, a continuous ramp, while the module (and
 * the page's own prose examples — "raid level 305 is 16%, 400 is 35%, 450 is
 * 45%") step every 5 levels. The stepped form reproduces all three stated
 * examples; the continuous one reproduces them only where they coincide.
 *
 * The `raidLevel < 150` case is in the module and NOT in the page's prose at
 * all: normal loot is scaled to 0.75.
 */
export function toaCommonQtyScale(raidLevel: number): number {
  if (raidLevel < 150) return 0.75
  if (raidLevel < 300) return 1
  return 1 + (Math.floor((raidLevel - 300) / 5) + 15) / 100
}

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

  /**
   * ToA's total unique chance. Consumed as a `formula`-kind `Rate` on the
   * single entry of the `toa:unique` preroll table, whose node is the 7-item
   * `oneOf`. See `toaUniqueRate` for why the total (rather than a per-item
   * rate) is the right thing for this position.
   */
  toa_invocation: (_params, ctx) => toaUniqueRate(ctx.points, ctx.raidLevel),

  /**
   * One unique's weight in that `oneOf`. `params.unique` names which, keyed by
   * `itemKey` so the boss document and this table cannot drift on spelling —
   * an unknown key throws rather than silently weighting the item at zero,
   * which would delete it from the pool and still produce a plausible-looking
   * distribution over the remaining six.
   */
  toa_unique_weight: (params, ctx) => {
    const unique = params['unique']
    if (typeof unique !== 'string' || !(unique in TOA_UNIQUES)) {
      throw new TypeError(
        `toa_unique_weight needs params.unique to be one of ${Object.keys(TOA_UNIQUES).join(', ')}, got ${String(unique)}`
      )
    }
    return toaUniqueWeight(unique as ToaUnique, ctx.raidLevel)
  },

  /**
   * A common-table item's quantity: `max(1, floor(floor(points / divisor) *
   * scale))`. Both floors are the module's, in that order — flooring the
   * scaled value of an already-floored base is not the same as flooring once.
   *
   * `params.divisor` is the item's own constant from the page's divisor table.
   * Cache of runes is not special-cased here: the module gives it a divisor of
   * 999,999, which makes the inner floor 0 and the `max(…, 1)` produce the
   * page's stated fixed quantity of 1 for any realistic points total. Keeping
   * that as data rather than a branch is what the no-per-boss-`if` rule asks
   * for.
   */
  toa_common_qty: (params, ctx) => {
    const divisor = params['divisor']
    if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor <= 0) {
      throw new TypeError(
        `toa_common_qty needs params.divisor to be a positive number, got ${String(divisor)}`
      )
    }
    const base = Math.floor(ctx.points / divisor)
    return Math.max(1, Math.floor(base * toaCommonQtyScale(ctx.raidLevel)))
  },

  /**
   * Elite clue: "For each 2k points in your personal contribution, you get 1
   * percentage point of clue chance, up to a max of 25%" (Mod Ash, 6 March
   * 2024, cited on the page).
   *
   * The cap is deliberately implemented even though
   * `Module:Tombs of Amascut loot` omits it — the module computes a bare
   * `points / 200000`. The page's prose and its primary source both state the
   * maximum, and the module is a calculator display whose other simplification
   * (per-player division by team size) is likewise not part of the mechanic.
   * Where the two disagree the cited primary source wins; noted here because
   * every other constant in this block resolves the other way.
   */
  toa_elite_clue: (_params, ctx) =>
    Math.min(ctx.points / TOA_ELITE_CLUE_DENOMINATOR, TOA_ELITE_CLUE_RATE_CAP),

  /**
   * Tumeken's guardian: "1% chance for every 350,000 - 700 x RL points", on
   * the pet's own scaled raid level. The page states no cap and neither does
   * the module, so none is applied — but the result is still a probability, so
   * `evaluateFormula`'s `[0, 1]` contract catches any context that would
   * exceed 1 rather than letting it through.
   */
  toa_pet: (_params, ctx) =>
    ctx.points / (100 * (350_000 - 700 * toaAdjustedRaidLevelPet(ctx.raidLevel))),

  /**
   * The thread-of-Elidinis / keris-jewel bad luck mitigation curve: "a base
   * rate that linearly interpolates to three times their base rate depending
   * on kill count", reaching 3x at a kill count of 1.5x the base denominator.
   *
   * `params.num`/`params.den` are the base rate (1/10 for the thread, 4/50 for
   * "any jewel"). `den` is the BASE denominator even when `num` is not 1 —
   * the jewels' cap is a kill count of 75, which is 1.5 x 50, not 1.5 x 12.5.
   * That is what the page's own worked figures say ("scales from 4/50 (1/12.5)
   * up to 12/50 (~1/4.17), when reaching a kill count of 75").
   *
   * `killCount` here is raid completions — the activity's own count, which is
   * what this loot source's kill count already means.
   */
  toa_bad_luck_mitigation: (params, ctx) => {
    const num = params['num']
    const den = params['den']
    if (typeof num !== 'number' || typeof den !== 'number' || num <= 0 || den <= 0) {
      throw new TypeError(
        `toa_bad_luck_mitigation needs positive numeric params.num/params.den, got ${String(num)}/${String(den)}`
      )
    }
    const multiplier = Math.min(3, 1 + (2 * ctx.killCount) / (1.5 * den))
    return Math.min(1, (num / den) * multiplier)
  },

  /**
   * ToB's unique pre-roll: `tobPoints / (32 * urate)`, reducing to exactly
   * 1/9.1 (Normal) or 1/7.7 (Hard) at full points, and to 0 whenever
   * `tobPoints` is 0 (an entry conditioned on `tobPoints >= 1` never reaches
   * this call at all in that state — see `docs/bosses/monumental-chest.md`'s
   * override — but the formula is correct there regardless, unlike
   * `tob_common_qty`, since `evaluateFormula` accepts 0 as a valid
   * probability).
   *
   * `params.urate` is required rather than read from `ctx.variant`: Hard and
   * the "Hard, time bonus" variant share the identical 7.7 rate (only the
   * common-table quantity differs between them), so the override supplies
   * the rate explicitly per entry instead of this function re-deriving mode
   * from a variant string it would otherwise need to know two different
   * spellings for.
   */
  tob_points: (params, ctx) => {
    const urate = params['urate']
    if (typeof urate !== 'number' || !Number.isFinite(urate) || urate <= 0) {
      throw new TypeError(`tob_points needs params.urate to be a positive number, got ${String(urate)}`)
    }
    return ctx.tobPoints / (TOB_MAX_POINTS * urate)
  },

  /**
   * ToB's common-table quantity multiplier: `modeMultiplier x ratio`, where
   * `ratio = tobPoints / 32`. Entry Mode is the one exception — a flat
   * constant, not ratio-scaled, since the calculator (the only source for the
   * ratio mechanic at all) has no Entry Mode option; see
   * `TOB_ENTRY_MODE_QTY_MULTIPLIER`.
   *
   * **The `Math.max(ctx.tobPoints, 1)` floor exists only to satisfy
   * `evaluateMultiplier`'s "must be positive" contract, not because a 0
   * multiplier would be wrong to compute.** `Table.qtyMultiplier` is resolved
   * once for the WHOLE table regardless of which entries survive condition
   * filtering (`compile.ts`'s `compileTable`), so this still runs even when
   * every one of `tob:common`'s entries has been filtered out by its own
   * `tobPoints >= 1` condition. The floor keeps that unconditional
   * evaluation from throwing on a genuinely reachable state (enough deaths or
   * skipped rooms to zero the raid out); the resulting value is never
   * actually applied to any quantity in that state, since there are no
   * surviving entries left to apply it to.
   */
  tob_common_qty: (_params, ctx) => {
    if (ctx.variant === 'entry') return TOB_ENTRY_MODE_QTY_MULTIPLIER
    const ratio = Math.max(ctx.tobPoints, 1) / TOB_MAX_POINTS
    if (ctx.variant === 'hard') return TOB_HARD_MODE_QTY_MULTIPLIER * ratio
    if (ctx.variant === 'hard-fast') return TOB_HARD_MODE_TIME_BONUS_QTY_MULTIPLIER * ratio
    return ratio
  },

  /**
   * CoX's unique roll, dispatched by `params.kind` since it fulfils three
   * DIFFERENT positions in the document while staying inside one `[0,1]`
   * probability contract (unlike `tob_points`/`tob_common_qty`, which needed
   * separate ids because they cross contracts):
   *
   * - `{kind:'roll', rollIndex: 1..6}` — one roll's own chance, for
   *   `cox:unique-rolls`' six `independent`-mode entries.
   * - `{kind:'eliteClueMarginal'}` — `(1 - P(any unique)) * 1/12`, "the elite
   *   clue scroll is only rolled when the player does not get a broadcasted
   *   unique reward."
   * - `{kind:'olmletMarginal'}` — `P(any unique) * 1/53`, "Olmlet is only
   *   rolled when the player gets a broadcasted unique reward" — cross-checked
   *   against the page's own cited example (26,025 points -> ~1/1,765): this
   *   formula gives 1/53 x 0.03001 = 1/1766, matching to the precision the
   *   page itself states.
   *
   * Both marginals are exact, not an approximation of same-kill correlation —
   * `ctx.points` is static for the whole run, so the conditioned marginal is
   * exactly what the simulator's aggregate statistics need
   * (`docs/HANDOFF.md`'s "What NOT to redo": the naive unconditioned subrates
   * would overstate Olmlet by 33x).
   */
  cox_points: (params, ctx) => {
    const kind = params['kind']
    if (kind === 'roll') {
      const rollIndex = params['rollIndex']
      if (
        typeof rollIndex !== 'number' ||
        !Number.isInteger(rollIndex) ||
        rollIndex < 1 ||
        rollIndex > COX_MAX_UNIQUE_ROLLS
      ) {
        throw new TypeError(
          `cox_points needs params.rollIndex to be an integer 1-${COX_MAX_UNIQUE_ROLLS}, got ${String(rollIndex)}`
        )
      }
      return coxRollChance(ctx.points, rollIndex)
    }
    if (kind === 'eliteClueMarginal') {
      return (1 - coxAnyUniqueProbability(ctx.points)) * (COX_ELITE_CLUE_RATE.num / COX_ELITE_CLUE_RATE.den)
    }
    if (kind === 'olmletMarginal') {
      return coxAnyUniqueProbability(ctx.points) * (COX_OLMLET_RATE.num / COX_OLMLET_RATE.den)
    }
    throw new TypeError(
      `cox_points needs params.kind to be 'roll', 'eliteClueMarginal' or 'olmletMarginal', got ${String(kind)}`
    )
  },

  /**
   * A common-table item's quantity: `floor(min(points, 131071) / divisor)`.
   * No floor of 1 the way ToA's equivalent has — the module applies none, and
   * nothing on the page contradicts that, so a selected item can genuinely
   * roll a quantity of 0 at low points. Torn prayer scroll and Dark relic are
   * NOT modelled through this formula at all: the module hardcodes their
   * quantity to a flat 1 regardless of points, which is expressed directly as
   * `QtySpec.exact(1)` in the override rather than a `divisor` large enough to
   * floor to zero (ToA's `cache-of-runes` trick) — the module's own special
   * case is exact, not an approximation needing a workaround.
   */
  cox_common_qty: (params, ctx) => {
    const divisor = params['divisor']
    if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor <= 0) {
      throw new TypeError(
        `cox_common_qty needs params.divisor to be a positive number, got ${String(divisor)}`
      )
    }
    return Math.floor(Math.min(ctx.points, COX_COMMON_QTY_POINTS_CAP) / divisor)
  },
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
  toa_invocation: ['points', 'raidLevel'],
  cox_points: ['points'],
  tob_points: ['tobPoints'],
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
  tob_common_qty: ['tobPoints', 'variant'],
  cox_common_qty: ['points'],
  zalcano_crystal_shards: ['shieldDamage', 'totalDamage', 'isMVP'],
  zalcano_mvp_share: ['isMVP'],
  zalcano_mvp_only: ['isMVP'],
  doom_of_mokhaiotl_deep_rolls: ['delveLevel'],
  lunar_chest_standard_rolls: ['moonsKilled'],
  toa_unique_weight: ['raidLevel'],
  toa_common_qty: ['points', 'raidLevel'],
  toa_elite_clue: ['points'],
  toa_pet: ['points', 'raidLevel'],
  toa_bad_luck_mitigation: ['killCount'],
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
 * Positive-weight contract — a formula used as a `weight` inside a `weighted`
 * table or a `oneOf` pool. Resolved once at compile time, like every other
 * Extension A formula position.
 *
 * Not rounded, and deliberately so: ToA's out-of-invocation-range uniques
 * carry a weight divided by 50, which is fractional by construction. A weight
 * is a share of a denominator, not a count, so there is nothing to round to.
 * Zero is rejected along with negatives — a zero weight would silently delete
 * an entry from its pool while leaving a plausible distribution over the rest,
 * which is the failure mode `toa_unique_weight` throws on rather than risks.
 */
export function evaluateWeight(
  formulaId: FormulaId,
  params: Record<string, unknown>,
  ctx: SimContext,
  registry: FormulaRegistry = defaultFormulaRegistry
): number {
  const value = callFormula(formulaId, params, ctx, registry)
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Formula '${formulaId}' returned ${value}, expected a positive weight`)
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
