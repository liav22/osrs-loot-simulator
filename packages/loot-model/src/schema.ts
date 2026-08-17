import { z } from 'zod'

// ---------------------------------------------------------------------------
// Formula ids (PROJECT_PLAN.md 4.6)
// ---------------------------------------------------------------------------

export const FORMULA_IDS = [
  'toa_invocation',
  'cox_points',
  'tob_points',
  'barrows_kc',
  'wintertodt_points',
  'tempoross_points',
  'wilderness_slayer',
  // Added for docs/mechanics-model-proposal.md's Extension A. Each is a real,
  // individually wiki-cited curve (see docs/bosses/*.md) with no existing id
  // whose shape fits — PROJECT_PLAN.md 4.6's "do not add more without
  // justification" is read as satisfied by that citation, not by convenience.
  'zalcano_points',
  'doom_of_mokhaiotl_uniques',
  'doom_of_mokhaiotl_qty',
  'fortis_colosseum_uniques',
  'fortis_colosseum_qty',
  'tzhaar_fight_cave_tokkul',
  'duke_sucellus_ice_quartz',
  /**
   * Theatre of Blood's second contract, alongside `tob_points`. Both read
   * `ctx.tobPoints` (the derived points total) but cannot share one id:
   * `tob_points` is a `[0,1]` probability (the unique pre-roll, via
   * `evaluateFormula`) and this is a positive multiplier (the common table's
   * `qtyMultiplier`, via `evaluateMultiplier`) — the same "one id cannot
   * fulfil two contracts at once" reasoning that split Zalcano's three ids
   * (PROJECT_PLAN.md 4.6's "do not add more without justification", satisfied
   * here the same way). See `docs/bosses/monumental-chest.md` and
   * `Module:Theatre of Blood calculator`.
   */
  'tob_common_qty',
  /**
   * CoX's second contract, alongside `cox_points`. `cox_points` is a `[0,1]`
   * probability (the six unique-roll entries AND the elite-clue/Olmlet
   * conditioned marginals all share that one contract, dispatched by
   * `params.kind` — see `formulas.ts`); this is the common table's per-item
   * quantity, `floor(min(points, 131071) / divisor)`, a non-negative-integer
   * contract via `evaluateQuantity`. Same "one id cannot fulfil two
   * contracts" reasoning as `tob_common_qty`. See
   * `docs/bosses/ancient-chest.md` and `Module:Chambers of Xeric calculator`.
   */
  'cox_common_qty',
  /**
   * Zalcano's three role-keyed rules, each stated outright on its page rather
   * than inferred. They are separate ids because they fulfil three different
   * formula contracts (quantity, multiplier, probability) and a single id
   * cannot return 3, 1.1 and 0 at once:
   *
   * - `zalcano_crystal_shards` — quantity: "Players eligible for a drop will
   *   receive one crystal shard, players eligible for unique drops or pet will
   *   receive two shards and the MVP will receive three shards."
   * - `zalcano_mvp_share` — multiplier: "The MVP ... will also receive an
   *   additional 10% (rounded up) of their non-unique loot."
   * - `zalcano_mvp_only` — probability: "Infernal ashes are only dropped for
   *   the MVP", i.e. always-or-never on a role, not a rate.
   *
   * Note what is deliberately NOT here: a curve turning `zalcano_points` into
   * loot. The page states that main- and tertiary-table drops "scale with the
   * player's points" and defines the points themselves, but never states the
   * scaling function — so `zalcano_points` stays a stub. See docs/DECISIONS.md.
   */
  'zalcano_crystal_shards',
  'zalcano_mvp_share',
  'zalcano_mvp_only',
  /**
   * How many times Doom of Mokhaiotl's ">8" loot row is rolled: one roll per
   * deep-delve level, i.e. `max(0, delveLevel - 8)`. Justified per
   * PROJECT_PLAN.md 4.6 by the page's own "Each delve level rolls once on the
   * regular loot table" plus a level table that caps its rows at ">8" while
   * descent does not cap — so levels 9..N all roll the same row, a count no
   * constant can express.
   */
  'doom_of_mokhaiotl_deep_rolls',
  /**
   * Lunar Chest's standard-loot roll count: 1 / 3 / 6 for one / two / three
   * Moons killed before opening. Justified per PROJECT_PLAN.md 4.6 by the
   * page's own `==Loot mechanics==` (revid 15284737) stating the multiplier is
   * 3x per additional Moon, not additive — a stepped lookup on
   * `moonsKilled.length` that no constant and no existing id expresses.
   */
  'lunar_chest_standard_rolls',
  /**
   * Tombs of Amascut. Six ids because ToA fulfils six different formula
   * contracts and one id cannot return a probability, a weight and an item
   * count at once — the same reasoning that split Zalcano's three.
   *
   * - `toa_invocation` (probability, pre-existing) — the raid's total unique
   *   chance: `min(points / (10500 - 20*RL) / 100, 0.55)`, scaled by the share
   *   of unique weight actually in range at this raid level.
   * - `toa_unique_weight` (weight) — one unique's weight in the 7-item pool.
   *   Only Osmumten's fang and the Lightbearer vary with raid level; the other
   *   five are constants and are authored as plain numbers.
   * - `toa_common_qty` (quantity) — `max(1, floor(floor(points/divisor) *
   *   scale))`, the common table's per-item quantity.
   * - `toa_elite_clue` (probability) — `min(points / 200000, 0.25)`.
   * - `toa_pet` (probability) — `points / (350000 - 700*RL_pet) / 100`.
   * - `toa_bad_luck_mitigation` (probability) — the thread/jewel curve,
   *   linear from `num/den` to `3*num/den` as kill count climbs to
   *   `1.5*den`.
   *
   * Every one is stated outright by the wiki — the prose and cited news
   * posts/tweets on `Chest (Tombs of Amascut)` for the rules, and
   * `Module:Tombs of Amascut loot` (the page's own rewards calculator) for the
   * integer weights and the flooring the prose states only continuously.
   * PROJECT_PLAN.md 4.6's "do not add more without justification" is read as
   * satisfied by that citation. See docs/bosses/chest-tombs-of-amascut.md.
   */
  'toa_unique_weight',
  'toa_common_qty',
  'toa_elite_clue',
  'toa_pet',
  'toa_bad_luck_mitigation',
] as const

export const FormulaIdSchema = z.enum(FORMULA_IDS)
export type FormulaId = z.infer<typeof FormulaIdSchema>

/**
 * `{ kind: 'formula', id, params }`, structurally identical to `Rate`'s
 * `formula` variant but reused wherever a formula's *output* is not a
 * `[0, 1]` probability: a `QtySpec`, a `weight`, `Table.qtyMultiplier`, or a
 * `TableRefNode`'s multiplier. Which contract applies is decided by where
 * this shape is used, not by the shape itself — `formulas.ts`'s
 * `evaluateQuantity`/`evaluateMultiplier`/`evaluateWeight` (vs.
 * `evaluateFormula`/`evaluateRate`) are the corresponding validators. See
 * docs/mechanics-model-proposal.md's Extension A.
 *
 * Declared here, above the rates block, because `WeightRateSchema` now
 * references it — see that schema's comment.
 */
export const FormulaRefSchema = z
  .object({
    kind: z.literal('formula'),
    id: FormulaIdSchema,
    params: z.record(z.unknown()).default({}),
  })
  .strict()

export type FormulaRef = z.infer<typeof FormulaRefSchema>

// ---------------------------------------------------------------------------
// Rates (4.1)
// ---------------------------------------------------------------------------

const AlwaysRateSchema = z.object({ kind: z.literal('always') }).strict()

/**
 * **`weight` may be a formula, resolved once at compile time** — Extension A's
 * missing fourth member. That extension gave `Table.rolls`, `QtySpec` and both
 * `qtyMultiplier` sites a formula-driven variant on one shared principle: a
 * per-run `SimContext` scalar may decide the *shape* of a table, and because
 * `SimContext` is fixed for the run, resolving it costs nothing per kill.
 * `weight` was the one member of that family left out, for the ordinary reason
 * that nothing had asked for it yet.
 *
 * Tombs of Amascut is the source that asks. Its 7-item unique pool is
 * reweighted by raid level, and `Module:Tombs of Amascut loot` states the rule
 * as `floor` expressions over the raid level rather than as a table of
 * breakpoints — Osmumten's fang alone takes a distinct integer weight at
 * roughly forty different raid levels. Enumerating those as condition-bracketed
 * static entries was considered and rejected: it is ~85 hand-computed entries
 * expressing one three-line rule, and it does not compose (CoX and ToB scale
 * the same way).
 *
 * Note what does NOT change: `weight` is still relative to a denominator and
 * still has no standalone probability (`rateToProbability` rejects it either
 * way), and a resolved weight must still be finite and positive, which
 * `evaluateWeight` enforces at compile time rather than here.
 */
const WeightRateSchema = z
  .object({
    kind: z.literal('weight'),
    weight: z.union([z.number().finite().positive(), FormulaRefSchema]),
  })
  .strict()

const FixedRateSchema = z
  .object({
    kind: z.literal('fixed'),
    num: z.number().finite().nonnegative(),
    den: z.number().finite().positive(),
  })
  .strict()

const FormulaRateSchema = z
  .object({
    kind: z.literal('formula'),
    id: FormulaIdSchema,
    params: z.record(z.unknown()).default({}),
  })
  .strict()

export const RateSchema = z
  .discriminatedUnion('kind', [
    AlwaysRateSchema,
    WeightRateSchema,
    FixedRateSchema,
    FormulaRateSchema,
  ])
  .superRefine((rate, ctx) => {
    if (rate.kind === 'fixed' && rate.num > rate.den) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fixed rate ${rate.num}/${rate.den} exceeds 1`,
        path: ['num'],
      })
    }
  })

export type Rate = z.infer<typeof RateSchema>

/** A positive scalar, or a formula that resolves to one at compile time. */
export const MultiplierSchema = z.union([z.number().finite().positive(), FormulaRefSchema])
export type Multiplier = z.infer<typeof MultiplierSchema>

/**
 * How a `qtyMultiplier` turns a rolled integer quantity into a final integer
 * one. Only consulted when the composed multiplier is not exactly 1.
 *
 * The wiki does not state one rule — it states three, and they are not
 * interchangeable. Measured across the real multiplier values in use
 * (`Q3` from 1 to 200):
 *
 * - `round` (**default, current behaviour**): `round(qty * m)`.
 * - `truncDelta`: `qty + trunc(qty * (m - 1))` — Doom of Mokhaiotl's stated
 *   `Qn = Q3 + trunc(Q3 * Mn)`.
 * - `ceilDelta`: `qty + ceil(qty * (m - 1))` — Zalcano's MVP bonus, which the
 *   page specifies as "+10% (rounded up) of the MVP's own non-unique loot".
 *
 * **Why the delta and not the product**, which is the non-obvious part:
 * `qty + trunc(qty * (m-1))` is NOT the same as `trunc(qty * m)` once `m < 1`,
 * because `trunc` rounds toward zero and the delta is then negative. At
 * `m = 0.65` the two disagree on 191 of 200 quantities (e.g. `qty = 5`: the
 * wiki's rule gives `5 + trunc(-1.75) = 4`, product-trunc gives `3`). For
 * `m > 1` they happen to coincide exactly. So a mode that merely names a
 * rounding function applied to the product could not express the rule these
 * sources actually use — the mode has to say what the rounding applies TO.
 *
 * Divergence from the `round` default is not a rare edge case either: at
 * Doom of Mokhaiotl's own per-level multipliers, `round` and `truncDelta`
 * disagree on roughly half of all quantities for every positive level
 * (80–100 of 200), and on 91 of 200 at level 2's `m = 0.65`. `m = 0.5` and
 * `m = 1` are the only values in that table where every mode agrees.
 */
export const QTY_ROUNDING_MODES = ['round', 'truncDelta', 'ceilDelta'] as const
export const QtyRoundingSchema = z.enum(QTY_ROUNDING_MODES)
export type QtyRounding = z.infer<typeof QtyRoundingSchema>

// ---------------------------------------------------------------------------
// Quantities (4.2)
// ---------------------------------------------------------------------------

const ExactQtySchema = z
  .object({ kind: z.literal('exact'), n: z.number().int().nonnegative() })
  .strict()

const RangeQtySchema = z
  .object({
    kind: z.literal('range'),
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .strict()

const ChoiceQtySchema = z
  .object({
    kind: z.literal('choice'),
    values: z.array(z.number().int().nonnegative()).min(1),
  })
  .strict()

/**
 * Resolved once at compile time against the (static, per-run) `SimContext`,
 * exactly like `Rate`'s existing `formula` variant — `compile.ts` collapses
 * it to a plain resolved quantity before `simulate.ts`/`expected-value.ts`
 * ever see it, so neither needs a per-roll formula re-evaluation. Covers a
 * quantity computed from scratch (ToA's `Points / ItemDivisor`, Inferno's/
 * TzHaar Fight Cave's Tokkul, Zalcano's role-keyed crystal-shard tiers — a
 * formula can return a discrete stepped value as easily as a continuous
 * one, so this is one variant, not a fourth `QtySpec` kind per role-keyed
 * vs. continuous shapes).
 */
export const QtySpecSchema = z
  .discriminatedUnion('kind', [ExactQtySchema, RangeQtySchema, ChoiceQtySchema, FormulaRefSchema])
  .superRefine((qty, ctx) => {
    if (qty.kind === 'range' && qty.min > qty.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `qty range min (${qty.min}) exceeds max (${qty.max})`,
        path: ['min'],
      })
    }
  })

export type QtySpec = z.infer<typeof QtySpecSchema>

// ---------------------------------------------------------------------------
// Conditions (4.4)
// ---------------------------------------------------------------------------

export const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('members'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('ringOfWealth'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('onSlayerTask'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('questComplete'), quest: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('variant'), name: z.string().min(1) }).strict(),
  /**
   * Gates an entry on a numeric `SimContext` field lying in `[n, atMost]`.
   * `atMost` is optional; without it this is the original one-sided "at least
   * `n`" threshold, which is what all 554 existing uses in `data/` are and why
   * the kind keeps its name rather than becoming `levelInRange` (that rename
   * would be a corpus-wide data migration for no behavioural gain).
   *
   * The field list is an enum of what real sources actually gate on rather
   * than a free-text field name, matching this project's practice of not
   * generalizing past confirmed cases (see docs/DECISIONS.md's repeated
   * "Uniques" heading refusals):
   *
   *  - `delveLevel` (Doom of Mokhaiotl), `wavesReached` (Fortis Colosseum) —
   *    the original two.
   *  - `shieldDamage`, `totalDamage` — Zalcano's two eligibility gates, both
   *    stated outright on its page: "Players must do at least 5 damage to
   *    Zalcano's shield to be eligible for drops, and 31 combined damage to be
   *    eligible for uniques and pet."
   *  - `fishingLevel` — Reward pool, and the reason `atMost` exists at all.
   *  - `killCount` — see the retirement note below.
   *
   * **`totalDamage` is why this stayed an enum widening instead of becoming a
   * new condition shape.** A combined threshold over two fields
   * (`hitpointsDamage + shieldDamage >= 31`) is not expressible by any
   * field-based condition at any enum width, which previously read as needing a
   * formula-valued condition — a fourth gating shape. It does not: the sum is
   * a *derived context field*, computed once at run setup by
   * `withDerivedContext` exactly like every other `SimContext` value, so
   * `levelAtLeast` reads it as a plain range test. Conditions stay
   * resolved-once against a fixed context, which `expectedValue` depends on
   * being literally true.
   *
   * **`atMost` is what makes a bracket expressible, and Reward pool is the
   * source that forced it.** Its fish sub-table has seven mutually exclusive
   * Fishing brackets — the page's own `dropversion` field lists them as
   * "Levels 35-39, 40-45, 46-49, 50-75, 76-78, 79-80, 81+". A one-sided `>=`
   * cannot express that: a level-99 player would match all seven at once and
   * receive seven fish tables instead of one. docs/DECISIONS.md's
   * "Player-stat gating" entry predicted exactly this ("the right change is an
   * optional upper bound on the existing `levelAtLeast`") and declined to add
   * `fishingLevel` to the enum until the bound existed, on the ground that
   * widening alone would not have unblocked its only requester. Both halves
   * land together here, which is what that entry asked for.
   *
   * `atMost` is INCLUSIVE, matching how the wiki writes the brackets
   * ("Levels 35–39" means 39 is in it), and the open-ended top bracket
   * ("81+") is expressed by simply omitting it.
   *
   * **`killCountAtLeast` is retired into this kind.** It was named separately
   * in PROJECT_PLAN.md 4.4, but its evaluator was byte-identical to this one
   * and it had **zero uses** across every `data/bosses/*.json`,
   * `data/tables/*.json` and `data/overrides/*.json` — measured, not assumed,
   * at the moment of removal. Two kinds doing one thing is the kind of
   * proliferation the `includes`/`levelAtLeast` split was careful to avoid, and
   * there was no migration to pay for. `{ kind: 'levelAtLeast', field:
   * 'killCount', n }` is the replacement spelling.
   */
  z
    .object({
      kind: z.literal('levelAtLeast'),
      field: z.enum([
        'delveLevel',
        'wavesReached',
        'shieldDamage',
        'totalDamage',
        'fishingLevel',
        'killCount',
        /**
         * Tombs of Amascut's three gates, all of them plain numeric reads on
         * `SimContext` fields that already existed. Widening the enum is the
         * whole change — which is the point worth recording, because the
         * research doc filed two of these as capability gaps needing new
         * condition shapes:
         *
         *  - `points` — the dung gate ("only obtained if a player ends the
         *    raid with less than 1,500 total reward points"), expressed as
         *    `n: 0, atMost: 1499`.
         *  - `raidLevel` — the three challenge rewards the wiki gates on raid
         *    level alone (350+/425+/500+).
         *  - `deaths` — "each of these challenges includes the requirement
         *    that there are zero deaths for all party members", expressed as
         *    `n: 0, atMost: 0`, which is what `atMost` makes sayable.
         *
         * This is the lesson `docs/bosses/lunar-chest.md`'s corrected banner
         * records, hit again: having a `SimContext` field is not the same as
         * being able to gate an entry on it. All three fields have existed
         * since Extension A; none of them was reachable from a condition.
         */
        'points',
        'raidLevel',
        'deaths',
        /**
         * Theatre of Blood's derived points total (`tobPoints`, see
         * `SimContextSchema`) — gates the zero-points consolation table
         * ("Only obtained if a player ends the raid with 0 individual
         * contribution points", cited directly on Monumental chest's own
         * page) and excludes the unique-preroll/common tables in that same
         * state, since a compiled `qtyMultiplier` is resolved unconditionally
         * regardless of which entries survive filtering (see `compile.ts`)
         * and cannot itself express "give nothing instead."
         */
        'tobPoints',
      ]),
      n: z.number().int().nonnegative(),
      /** Inclusive upper bound. Omit for an open-ended threshold. */
      atMost: z.number().int().nonnegative().optional(),
    })
    .strict(),
  /**
   * Set membership over a set-valued `SimContext` field — a genuinely
   * different shape from `levelAtLeast`'s numeric threshold, not a variant of
   * it, and the reason it is its own kind rather than another entry in that
   * enum. The three gating shapes this project has now met are: numeric
   * threshold (`levelAtLeast`), numeric *bracket* (Reward pool's seven
   * mutually-exclusive Fishing tiers — still unbuilt, and provably not
   * expressible by widening `levelAtLeast`, since a one-sided `>=` matches
   * every bracket at once for a high-level player), and set membership
   * (this). No one condition kind covers all three.
   *
   * **`values` means ANY of them (disjunction), deliberately.** Conjunction is
   * already available for free — `conditionsHold` ANDs the whole
   * `conditions` array, so "blood AND blue" is two `includes` conditions.
   * Disjunction has no other expression in the model at all, so that is the
   * meaning worth spending this field on. A single-element `values` is the
   * common case (Lunar Chest gates each Moon's roll on that Moon being among
   * the ones killed) and reads identically under either rule.
   *
   * `questsComplete` is admitted alongside `moonsKilled` so this is a real
   * mechanism over set-valued fields rather than a `moonsKilled` special case
   * wearing a general name. The pre-existing `questComplete` kind stays: it is
   * named in PROJECT_PLAN.md 4.4 and is in live use in `data/`, so retiring it
   * would be a data migration for no behavioural gain.
   */
  z
    .object({
      kind: z.literal('includes'),
      field: z.enum(['moonsKilled', 'questsComplete']),
      values: z.array(z.string().min(1)).min(1),
    })
    .strict(),
])
  // Refined on the UNION rather than on the `levelAtLeast` member: zod's
  // `discriminatedUnion` requires every option to be a plain `ZodObject`, and
  // attaching a `.superRefine` to one turns it into a `ZodEffects` that the
  // union will not accept. Wrapping the finished union is equivalent and keeps
  // the discriminated dispatch (and its far better error messages) intact.
  .superRefine((condition, ctx) => {
    // An inverted bracket matches nothing at all, which is never what an
    // author meant — it silently deletes the entry instead of gating it, and
    // `compileTable` would drop it with no complaint anywhere.
    if (
      condition.kind === 'levelAtLeast' &&
      condition.atMost !== undefined &&
      condition.atMost < condition.n
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['atMost'],
        message: `'atMost' (${condition.atMost}) is below 'n' (${condition.n}), so this condition can never hold`,
      })
    }
  })

export type Condition = z.infer<typeof ConditionSchema>

/**
 * Gates an `Entry` on how many of a specific item the player owns *entering
 * this simulated run* (`SimContext.ownedCounts[itemKey]`) — Duke Sucellus'
 * ice quartz/frozen tablet, ToA's thread/jewels, Lunar Chest's per-set
 * duplicate protection, Reward Cart's 3rd+-owned substitution. All four are
 * **lifetime-scoped**: the count only ever grows, persists for the whole
 * simulated batch (and beyond it), and starts from the caller-supplied
 * entering value — never resets mid-batch. None of them are *run-scoped* the
 * way Fortis Colosseum's wave-to-wave armour dedup would be (state that
 * resets at the start of each new attempt) — that's a materially different,
 * still-unbuilt problem (see docs/mechanics-model-proposal.md's "Deferred"
 * section), not a variant of this one.
 *
 * **Deliberately NOT a `Condition` kind**, even though it reads like one.
 * Every existing `Condition` is resolved exactly once, against a `SimContext`
 * fixed for the whole run (`compile.ts`'s header comment: "Conditions are
 * resolved once here because `SimContext` is fixed for the duration of a
 * run") — `expectedValue` relies on that being true (it computes one kill's
 * expectation, so a static entering `ownedCounts` is all it ever needs), but
 * `simulate` cannot honor it for `ownershipGate`: whether a Reward Cart
 * search is past its 3rd warm gloves is itself an outcome of *earlier
 * simulated kills in the same run*, so it has to be re-checked once per
 * kill, against a live, mutating count `simulate.ts` tracks alongside the
 * seeded RNG stream (never as a second source of randomness — the mutation
 * is a deterministic function of what the same seed already produced, so
 * "same seed + same input ⇒ same output" still holds). Folding this into
 * `Condition` would either be a lie for the six existing kinds' shared
 * contract, or force all of them to pay for per-kill re-evaluation they
 * don't need. It's therefore its own field on `Entry`, checked by
 * `compile.ts`/`simulate.ts`/`expected-value.ts` at the point each of them
 * actually needs it, not folded into `entryApplies`'s static pass.
 */
export const OwnershipGateSchema = z
  .object({
    itemKey: z.string().min(1),
    n: z.number().int().nonnegative(),
    /** 'below' = applies while owned < n (not yet reached); 'atLeast' = applies once owned >= n. */
    when: z.enum(['below', 'atLeast']),
  })
  .strict()

export type OwnershipGate = z.infer<typeof OwnershipGateSchema>

// ---------------------------------------------------------------------------
// Nodes and entries (4.2, 4.3)
//
// `oneOf` nests one level deep: its entries carry leaf nodes only. Deeper
// nesting is expressed with `tableRef`, which section 5 already designates as
// the mechanism for nested tables. This keeps every type inferred from its
// schema — zod 3 cannot infer a truly recursive schema without a hand-written
// type annotation, which the conventions forbid. See docs/DECISIONS.md.
// ---------------------------------------------------------------------------

const ItemNodeSchema = z
  .object({
    kind: z.literal('item'),
    /**
     * The resolved OSRS item id, or `null` when it cannot be resolved to a
     * single id — e.g. a page covering many distinct in-game ids (clue scroll
     * tiers) or a bucket lookup that returned no match. Never a sentinel like
     * `0`; `null` is the only "unresolved" value so a real id 0 (if one ever
     * existed) could never be confused with "not found".
     */
    itemId: z.number().int().nonnegative().nullable(),
    /**
     * A stable slug identifier for the item, derived from its wiki page name.
     * Required even when `itemId` is null, since it is what the `items_known`
     * check and the multi-id allowlist key off of.
     */
    itemKey: z.string().min(1),
    name: z.string().min(1),
    qty: QtySpecSchema,
    noted: z.boolean().optional(),
  })
  .strict()

const TableRefNodeSchema = z
  .object({
    kind: z.literal('tableRef'),
    ref: z.string().min(1),
    /**
     * Scales whatever this specific access yields, without touching the
     * shared, unscaled `data/tables/*.json` record other sources reference
     * plainly (Abyssal Sire's flat ×2 on `rare_drop_table`). Composes with a
     * parent `Table.qtyMultiplier` if both are present — `simulate.ts`/
     * `expected-value.ts` multiply through nesting, not replace.
     */
    qtyMultiplier: MultiplierSchema.optional(),
    /** How `qtyMultiplier` rounds. Defaults to `round`; see `QtyRoundingSchema`. */
    qtyRounding: QtyRoundingSchema.optional(),
    /**
     * How many times the referenced table is evaluated when this entry's own
     * `rate` hits. Absent (the default) means once, which is what every
     * source but one wants.
     *
     * **The narrow, confirmed exception to `Table.rolls`' meaning**, and the
     * whole reason this field exists. `rolls: N` on an access line means "N
     * independent access attempts" everywhere else in this codebase — the
     * reading verified across the whole tier-C RDT/gem wiring pass. Corporeal
     * Beast is the one cited counter-example: its own `{{GemDropTable}}` call
     * says "a 12/512 chance of rolling the gem drop table, **whereupon its
     * contents are rolled 10 times**" — ONE access check gating a batch of 10
     * guaranteed draws, not 10 checks each gating one draw. The two differ by
     * an order of magnitude in yield-per-proc, so the default reading is
     * actively wrong for this source rather than merely imprecise.
     *
     * Scoped to a `tableRef` node, not `Table.rolls`, deliberately:
     * `Table.rolls`' existing meaning is correct in general and must not be
     * "fixed" globally over this single source (docs/DECISIONS.md's tier-C
     * wiring entry says so explicitly). Prior research confirmed this shape
     * does not recur anywhere else in the corpus, so this stays an
     * escape hatch for one access pattern rather than a new `TableMode`.
     */
    drawsPerHit: z.number().int().positive().optional(),
  })
  .strict()

const NothingNodeSchema = z.object({ kind: z.literal('nothing') }).strict()

export const LeafNodeSchema = z.discriminatedUnion('kind', [
  ItemNodeSchema,
  TableRefNodeSchema,
  NothingNodeSchema,
])

export type LeafNode = z.infer<typeof LeafNodeSchema>

export const LeafEntrySchema = z
  .object({
    node: LeafNodeSchema,
    rate: RateSchema,
    conditions: z.array(ConditionSchema).optional(),
    /**
     * Same field, same semantics as `Entry.ownershipGate` — see
     * `OwnershipGateSchema`. `compile.ts` previously said this was left off
     * `LeafEntry` because "none of the four Extension B sources need ownership
     * *inside* a oneOf, so it's out of scope rather than added speculatively."
     * Tombs of Amascut is the source that needs it, which is the bar that
     * comment set.
     *
     * The keris partisan jewels: "If the player is missing one or more of the
     * four jewels, they will be guaranteed to receive an unobtained one upon
     * successfully rolling for a jewel. This effectively changes the rarity of
     * unowned jewels to 1/37.5, 1/25, and 1/12.5 when owning one, two, or
     * three." That is exactly a `oneOf` whose pool is the *unowned* jewels —
     * four entries each gated `below 1`, renormalised over whichever survive.
     * `effectiveWeightedPool` already does that renormalisation, and a `oneOf`
     * already compiles to a weighted `CompiledTable`, so both consumers get
     * this for free once `compileOneOf` stops discarding the field.
     *
     * Modelling it any other way is measurably wrong rather than merely
     * imprecise: four independent gated entries would let two jewels arrive in
     * one raid, and a compile-time-frozen rate reading `ownedCounts` could not
     * move as jewels are acquired mid-batch, since only `ownershipGate` is
     * re-evaluated per kill.
     */
    ownershipGate: OwnershipGateSchema.optional(),
  })
  .strict()

export type LeafEntry = z.infer<typeof LeafEntrySchema>

const OneOfNodeSchema = z
  .object({
    kind: z.literal('oneOf'),
    entries: z.array(LeafEntrySchema).min(1),
  })
  .strict()

export const NodeSchema = z
  .discriminatedUnion('kind', [
    ItemNodeSchema,
    TableRefNodeSchema,
    NothingNodeSchema,
    OneOfNodeSchema,
  ])
  .superRefine((node, ctx) => {
    if (node.kind === 'tableRef' && node.qtyRounding !== undefined && node.qtyMultiplier === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'qtyRounding' has no meaning without a 'qtyMultiplier'",
        path: ['qtyRounding'],
      })
    }
    if (node.kind !== 'oneOf') return
    node.entries.forEach((entry, i) => {
      if (entry.rate.kind !== 'weight') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `oneOf entries must use weight rates, got '${entry.rate.kind}'`,
          path: ['entries', i, 'rate'],
        })
      }
    })
  })

export type Node = z.infer<typeof NodeSchema>

export const EntrySchema = z
  .object({
    node: NodeSchema,
    rate: RateSchema,
    conditions: z.array(ConditionSchema).optional(),
    /** See `OwnershipGateSchema`'s comment for why this isn't in `conditions`. */
    ownershipGate: OwnershipGateSchema.optional(),
  })
  .strict()

export type Entry = z.infer<typeof EntrySchema>

// ---------------------------------------------------------------------------
// Tables (4.3)
// ---------------------------------------------------------------------------

export const TABLE_MODES = ['always', 'preroll', 'weighted', 'independent'] as const
export const TableModeSchema = z.enum(TABLE_MODES)
export type TableMode = z.infer<typeof TableModeSchema>

/**
 * Rate kinds each mode's entries are allowed to use.
 *
 * `independent` allows `always` alongside `fixed`/`formula`: several real
 * "Tertiary" sections (Vardorvis, Duke Sucellus, The Leviathan, The
 * Whisperer) legitimately interleave a quest/encounter-gated guaranteed drop
 * (`rarity=Always`) with ordinary chance-based tertiary rows under one
 * heading — a genuine wiki shape, not a parser error. Mechanically this was
 * always safe: `rateToProbability('always')` is 1, and `independent` already
 * evaluates every entry as its own independent Bernoulli trial via
 * `table.probs[i]`, so an always-rate entry is just the degenerate p=1 case,
 * identical in kind to a `fixed` rate of 1/1. `preroll` still excludes
 * `always` on purpose: preroll's chain-order semantics make an unconditional
 * entry dominate everything checked after it, which is a real, different
 * shape (and preroll is capped at `rolls: 1`, so it cannot be a harmless
 * no-op the way it might be elsewhere).
 */
const ALLOWED_ENTRY_RATES: Record<TableMode, readonly Rate['kind'][]> = {
  always: ['always'],
  preroll: ['fixed', 'formula'],
  weighted: ['weight'],
  independent: ['always', 'fixed', 'formula'],
}

export const TableSchema = z
  .object({
    id: z.string().min(1),
    mode: TableModeSchema,
    /**
     * `rolls` as a `Rate` normally means "roll this table once with
     * probability p" (PROJECT_PLAN.md 4.3's decision log). A `formula`-kind
     * `Rate` here is the one exception: `compile.ts` evaluates it via
     * `evaluateQuantity` (a non-negative integer count) rather than
     * `rateToProbability` (a `[0, 1]` chance), giving Lunar Chest's
     * 1/3/6-roll count a home without a new schema arm — reusing `Rate`'s
     * existing `formula` shape rather than adding a fourth `rolls` type that
     * would be structurally indistinguishable from it. Confirmed safe: no
     * currently-parsed source uses a `formula`-kind rate as `rolls` today, so
     * this reinterpretation changes nothing already shipped.
     */
    rolls: z.union([z.number().int().positive(), RateSchema]).default(1),
    denominator: z.number().finite().positive().optional(),
    withoutReplacement: z.boolean().default(false),
    entries: z.array(EntrySchema).min(1),
    notes: z.string().optional(),
    /**
     * Scales every quantity rolled from this table's own entries (Duke
     * Sucellus's perfect-kill +50%, ToB's mode/death scaling, Zalcano's MVP
     * +10% "of what this player already got" — mechanically identical to the
     * other two once `qtyMultiplier` is understood as applying to the
     * table's own realized draw, not as a separate roll). Composes with a
     * `TableRefNode.qtyMultiplier` when this table is itself reached through
     * one.
     */
    qtyMultiplier: MultiplierSchema.optional(),
    /** How `qtyMultiplier` rounds. Defaults to `round`; see `QtyRoundingSchema`. */
    qtyRounding: QtyRoundingSchema.optional(),
    /**
     * A hit on ANY entry of this table suppresses the `preroll`/`weighted`
     * tables later in the document — the same set a preroll hit suppresses
     * (`suppressedByPreroll`), reached by a different trigger. Absent (the
     * default) means this table suppresses nothing, which is every table in
     * every source shipped so far.
     *
     * `independent`-mode only, and that restriction is the point. CoX's
     * Ancient chest is the confirmed source: its unique table rolls up to six
     * uniques *independently* (so multiple can hit in one raid), yet a hit
     * anywhere in it replaces the player's entire chest, suppressing the
     * common table. Neither existing mode expresses that — `preroll`'s
     * "first hit short-circuits" would discard unique rolls 2–6, and plain
     * `independent` suppresses nothing. This flag is the missing half:
     * "every entry rolls separately, but any hit ends the main chain."
     *
     * Note what it does NOT do: a hit does not stop this table's own
     * remaining `rolls`, only the later tables in the document. And a nested
     * table's chain stays local (docs/DECISIONS.md, Phase 1) — setting this
     * on a table reached through a `tableRef`/`oneOf` suppresses nothing in
     * the parent, exactly as a nested preroll hit doesn't.
     */
    suppressesFollowing: z.boolean().optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
    // A rounding mode with nothing to round is a silently-inert field, which
    // reads as "this table scales quantities" when it doesn't. Reject it.
    if (table.qtyRounding !== undefined && table.qtyMultiplier === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'qtyRounding' has no meaning without a 'qtyMultiplier'",
        path: ['qtyRounding'],
      })
    }
    if (table.suppressesFollowing === true && table.mode !== 'independent') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `'suppressesFollowing' only applies to independent tables, not '${table.mode}' ` +
          `(a preroll already suppresses; 'always'/'weighted' hit every kill, which would ` +
          `suppress the rest of the document unconditionally)`,
        path: ['suppressesFollowing'],
      })
    }
    if (table.mode === 'weighted' && table.denominator === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weighted tables require a 'denominator'",
        path: ['denominator'],
      })
    }
    if (table.mode !== 'weighted' && table.denominator !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'denominator' is only meaningful on weighted tables, not '${table.mode}'`,
        path: ['denominator'],
      })
    }

    const allowed = ALLOWED_ENTRY_RATES[table.mode]
    table.entries.forEach((entry, i) => {
      if (!allowed.includes(entry.rate.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `'${table.mode}' entries must use ${allowed.join(' or ')} rates, got '${entry.rate.kind}'`,
          path: ['entries', i, 'rate'],
        })
      }
    })

    // A preroll's semantics are "checked in order, first hit short-circuits".
    // Repeating that pass has no defined meaning, so reject it at the boundary
    // rather than guess (see docs/DECISIONS.md).
    if (table.mode === 'preroll' && !(typeof table.rolls === 'number' && table.rolls === 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preroll tables must have 'rolls: 1'",
        path: ['rolls'],
      })
    }

    if (typeof table.rolls !== 'number' && table.rolls.kind === 'weight') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'rolls' cannot be a weight rate; weights are relative to a denominator",
        path: ['rolls'],
      })
    }

    if (table.withoutReplacement) {
      if (table.mode !== 'weighted') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `'withoutReplacement' only applies to weighted tables, not '${table.mode}'`,
          path: ['withoutReplacement'],
        })
      }
      if (!(typeof table.rolls === 'number' && table.rolls > 1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "'withoutReplacement' requires a numeric 'rolls' greater than 1",
          path: ['withoutReplacement'],
        })
      }
    }
  })

export type Table = z.infer<typeof TableSchema>

// ---------------------------------------------------------------------------
// Simulation context (4.4)
// ---------------------------------------------------------------------------

export const SimContextSchema = z
  .object({
    members: z.boolean(),
    ringOfWealth: z.boolean(),
    onSlayerTask: z.boolean(),
    questsComplete: z.array(z.string().min(1)),
    killCount: z.number().int().nonnegative(),
    variant: z.string().min(1),
    // Added for docs/mechanics-model-proposal.md's Extension A. All static
    // per-run scalars, resolved once at compile time exactly like the six
    // fields above — none of the 36 currently-verified sources reference
    // any of them, so their defaults below are inert for every boss doc
    // that doesn't opt in.
    /** ToA, CoX, Tempoross, Wintertodt — this run's activity-points total. */
    points: z.number().int().nonnegative().default(0),
    /** ToA's configured raid invocation level (0-500). */
    raidLevel: z.number().int().nonnegative().default(0),
    /** ToB's death count this raid. Each death costs 4 of the raid's 32 max points — see `tobPoints`. */
    deaths: z.number().int().nonnegative().default(0),
    /**
     * ToB's rooms skipped this raid (of 6: Maiden, Bloat, Nylocas, Sotetseg,
     * Xarpus, Verzik) — a genuinely different penalty from `deaths`, both
     * read by the derived `tobPoints` below. Capped at 6, unlike `deaths`,
     * because the raid structurally has only 6 skippable rooms.
     * `Module:Theatre of Blood calculator`'s `Player's Rooms Skipped (0-6)`
     * input; no page prose states this mechanic at all — see
     * docs/bosses/monumental-chest.md.
     */
    roomsSkipped: z.number().int().min(0).max(6).default(0),
    /** Duke Sucellus's no-avoidable-damage bonus. */
    perfectKill: z.boolean().default(false),
    /** Zalcano's MVP-of-the-kill bonus. */
    isMVP: z.boolean().default(false),
    /** Doom of Mokhaiotl's deepest delve level reached this run. */
    delveLevel: z.number().int().nonnegative().default(0),
    /** Fortis Colosseum's deepest wave reached this run. */
    wavesReached: z.number().int().nonnegative().default(0),
    /** Lunar Chest — which Moons were killed before this chest opening. */
    moonsKilled: z.array(z.enum(['blood', 'blue', 'eclipse'])).default([]),
    /** Reward pool — Fishing level at time of redemption. */
    fishingLevel: z.number().int().min(1).max(99).default(1),
    /** Zalcano's two damage inputs — kept raw rather than pre-derived into one `points`, since `zalcano_points` needs both `H` and `S` under different caps. */
    hitpointsDamage: z.number().int().nonnegative().default(0),
    shieldDamage: z.number().int().nonnegative().default(0),
    /**
     * **Derived, not an input.** `hitpointsDamage + shieldDamage`, recomputed
     * from those two by `withDerivedContext` at run setup — whatever a caller
     * supplies here is overwritten, so it can never drift from its inputs.
     *
     * It exists as a real field, rather than being computed inside a condition,
     * so that Zalcano's combined eligibility gate (`>= 31`) is an ordinary
     * `levelAtLeast` read. That keeps the invariant this model has now
     * protected twice: a `Condition` is resolved exactly once against a
     * `SimContext` fixed for the whole run (`compile.ts`'s header comment), and
     * `expectedValue` computes one kill's expectation from that static context
     * with no notion of "later in the run". A formula-valued condition — the
     * other way to express a two-field threshold — would have made conditions
     * arbitrary code and broken that contract for every kind, to serve one
     * source. A derived field costs nothing and changes no contract: it is
     * resolved once, at the same moment as everything around it.
     */
    totalDamage: z.number().int().nonnegative().default(0),
    /**
     * **Derived, not an input.** Theatre of Blood's per-run points total, out
     * of a solo maximum of 32: 3 per room cleared (18 max, from
     * `roomsSkipped`) plus a flat 14 "MVP bonus" (a solo player always
     * receives the whole shared pool) minus 4 per death, floored at 0.
     * Recomputed by `withDerivedContext` from `roomsSkipped` and `deaths`,
     * same discipline as `totalDamage` — resolved once, at run setup, so
     * `Condition`/`expectedValue`'s "fixed for the whole run" contract holds.
     *
     * Sourced entirely from `Module:Theatre of Blood calculator`
     * (`playerpoints = max(0,(6-iskip)*3 + imvp - ideath*4)`, `imvp = 14` for
     * a solo player since the whole team's pool has nobody else to share
     * with); no prose on the page states the formula, only the fact that a
     * raid can reach 0 points. See docs/bosses/monumental-chest.md.
     */
    tobPoints: z.number().int().nonnegative().default(0),
    /**
     * How many of each item (keyed by `itemKey`) the player owns *entering*
     * this run — Extension B's `OwnershipGateSchema` reads this as the
     * starting point. `expectedValue` treats it as fixed, same as every
     * other field here; `simulate` additionally tracks it live as kills
     * happen, since it's the one field whose relevant fact ("have you
     * gotten this yet") can become true partway through a simulated batch.
     * See `OwnershipGateSchema`'s comment.
     */
    ownedCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict()

export type SimContext = z.infer<typeof SimContextSchema>

export type SimContextField = keyof SimContext

/**
 * Fields `withDerivedContext` computes, mapped to the inputs they read.
 *
 * A UI must never offer a control for a derived field — setting it is a no-op,
 * since the derivation overwrites whatever is supplied. It should offer the
 * inputs instead, which is what `apps/web` expands these to. Keeping the
 * relationship here rather than in the frontend means one declaration serves
 * the derivation, the UI, and anything else that needs to know.
 */
export const DERIVED_CONTEXT_FIELDS = {
  totalDamage: ['hitpointsDamage', 'shieldDamage'],
  tobPoints: ['roomsSkipped', 'deaths'],
} as const satisfies Partial<Record<SimContextField, readonly SimContextField[]>>

export const PartialSimContextSchema = SimContextSchema.partial()
export type PartialSimContext = z.infer<typeof PartialSimContextSchema>

export const DEFAULT_SIM_CONTEXT: SimContext = {
  members: true,
  ringOfWealth: false,
  onSlayerTask: false,
  questsComplete: [],
  killCount: 0,
  variant: 'normal',
  points: 0,
  raidLevel: 0,
  deaths: 0,
  roomsSkipped: 0,
  perfectKill: false,
  isMVP: false,
  delveLevel: 0,
  wavesReached: 0,
  moonsKilled: [],
  fishingLevel: 1,
  hitpointsDamage: 0,
  shieldDamage: 0,
  totalDamage: 0,
  tobPoints: 32,
  ownedCounts: {},
}

// ---------------------------------------------------------------------------
// Validation result (7)
// ---------------------------------------------------------------------------

export const VALIDATION_CHECKS = [
  'weights_sum',
  'refs_resolve',
  'rates_valid',
  'qty_sane',
  'ev_matches',
  'items_known',
  /**
   * Fails when a loot source appears in `data/mechanics-watchlist.json`.
   * A watchlisted source has a mechanic the parser cannot see in the drop rows
   * — point scaling, uniques drawn without replacement — so parsing it
   * cleanly proves nothing. The check exists to stop a plausible-looking
   * result from being marked `verified`.
   */
  'not_on_watchlist',
  /**
   * Fails when the wiki lists a drop the parsed document does not reach.
   *
   * Every other check here is closed-world over the extracted document — they
   * validate what IS present. None of them can see a drop table that produced
   * zero rows, because an empty section and an absent section are the same
   * thing downstream. `drops_covered` compares the document against the
   * `dropsline` bucket snapshot, which the wiki generates from the RENDERED
   * page and so sees through the transclusions raw wikitext hides
   * (`===Sigils=== {{Uniques/Corporeal Beast}}`).
   */
  'drops_covered',
] as const

export const ValidationCheckSchema = z.enum(VALIDATION_CHECKS)
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>

export const ValidationResultSchema = z
  .object({
    ok: z.boolean(),
    checks: z.array(
      z
        .object({
          check: ValidationCheckSchema,
          ok: z.boolean(),
          detail: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict()

export type ValidationResult = z.infer<typeof ValidationResultSchema>

// ---------------------------------------------------------------------------
// Boss document (4.5)
// ---------------------------------------------------------------------------

export const BossStatusSchema = z.enum(['verified', 'needs_review', 'manual_override'])
export type BossStatus = z.infer<typeof BossStatusSchema>

export const BossSourceSchema = z.enum(['generated', 'override', 'merged'])
export type BossSource = z.infer<typeof BossSourceSchema>

export const BossSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    wikiPage: z.string().min(1),
    wikiRevId: z.number().int().nonnegative(),
    variants: z.array(z.string().min(1)).min(1).default(['normal']),
    tables: z.array(TableSchema),
    contextDefaults: PartialSimContextSchema.default({}),
    status: BossStatusSchema,
    validation: ValidationResultSchema,
    source: BossSourceSchema,
    /**
     * Provenance metadata — which parser format produced this document, for a
     * human reading the file. **Not a staleness mechanism**: nothing reads
     * this back to decide whether to re-parse, and every parse invocation
     * currently writes the same literal `1` (`apps/ingest/src/main.ts`). The
     * real staleness guard is `apps/ingest/test/corpus-reproducibility.test.ts`,
     * which re-parses every committed document from its snapshot and diffs
     * against what's on disk — a live check, not a hand-maintained number. See
     * `docs/DECISIONS.md`'s "`parserVersion` retired as a staleness mechanism"
     * entry before wiring a comparison against this field; that was
     * considered and rejected in favour of the diff-based check.
     */
    parserVersion: z.number().int().nonnegative(),
    /**
     * Whether the same account can generate more than one independent roll
     * against this source — false for a boss fought once during a quest and
     * never again. Not a loot-mechanics fact and never read by
     * `simulate`/`expectedValue`; it is corpus scope metadata, derived from
     * wiki category/prose signals in `apps/ingest/src/inventory/build.ts` and
     * carried through unchanged by the parser. Defaults to `true` since that
     * is the overwhelming majority and most test fixtures don't care.
     */
    repeatable: z.boolean().default(true),
  })
  .strict()
  .superRefine((boss, ctx) => {
    const seen = new Set<string>()
    boss.tables.forEach((table, i) => {
      if (seen.has(table.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate table id '${table.id}'`,
          path: ['tables', i, 'id'],
        })
      }
      seen.add(table.id)
    })
  })

export type Boss = z.infer<typeof BossSchema>
export type BossInput = z.input<typeof BossSchema>

/** A `data/tables/*.json` record. Shared tables are plain tables (5). */
export const SharedTableSchema = TableSchema
export type SharedTable = Table
