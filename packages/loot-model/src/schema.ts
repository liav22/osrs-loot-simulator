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
] as const

export const FormulaIdSchema = z.enum(FORMULA_IDS)
export type FormulaId = z.infer<typeof FormulaIdSchema>

// ---------------------------------------------------------------------------
// Rates (4.1)
// ---------------------------------------------------------------------------

const AlwaysRateSchema = z.object({ kind: z.literal('always') }).strict()

const WeightRateSchema = z
  .object({ kind: z.literal('weight'), weight: z.number().finite().positive() })
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

/**
 * `{ kind: 'formula', id, params }`, structurally identical to `Rate`'s
 * `formula` variant but reused wherever a formula's *output* is not a
 * `[0, 1]` probability: a `QtySpec`, `Table.qtyMultiplier`, or a
 * `TableRefNode`'s multiplier. Which contract applies is decided by where
 * this shape is used, not by the shape itself — `formulas.ts`'s
 * `evaluateQuantity`/`evaluateMultiplier` (vs. `evaluateFormula`/
 * `evaluateRate`) are the corresponding validators. See
 * docs/mechanics-model-proposal.md's Extension A.
 */
export const FormulaRefSchema = z
  .object({
    kind: z.literal('formula'),
    id: FormulaIdSchema,
    params: z.record(z.unknown()).default({}),
  })
  .strict()

export type FormulaRef = z.infer<typeof FormulaRefSchema>

/** A positive scalar, or a formula that resolves to one at compile time. */
export const MultiplierSchema = z.union([z.number().finite().positive(), FormulaRefSchema])
export type Multiplier = z.infer<typeof MultiplierSchema>

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
  z.object({ kind: z.literal('killCountAtLeast'), n: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('variant'), name: z.string().min(1) }).strict(),
  /**
   * Gates an entry on one of the two confirmed level/wave-indexed `SimContext`
   * fields reaching at least `n`. Kept to an enum of the two sources that
   * actually need it (Doom of Mokhaiotl's `delveLevel`, Fortis Colosseum's
   * `wavesReached`) rather than a free-text field name, matching this
   * project's established practice of not generalizing past confirmed cases
   * (see docs/DECISIONS.md's repeated "Uniques" heading refusals). Widen to a
   * free-text `field: string` only if a third source needs it.
   */
  z
    .object({
      kind: z.literal('levelAtLeast'),
      field: z.enum(['delveLevel', 'wavesReached']),
      n: z.number().int().nonnegative(),
    })
    .strict(),
])

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
    /** ToB's death count this raid (death-penalty magnitude is UNKNOWN — see docs/bosses/monumental-chest.md). */
    deaths: z.number().int().nonnegative().default(0),
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
  perfectKill: false,
  isMVP: false,
  delveLevel: 0,
  wavesReached: 0,
  moonsKilled: [],
  fishingLevel: 1,
  hitpointsDamage: 0,
  shieldDamage: 0,
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
    parserVersion: z.number().int().nonnegative(),
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
