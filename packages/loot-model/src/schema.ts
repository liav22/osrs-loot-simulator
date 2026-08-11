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

export const QtySpecSchema = z
  .discriminatedUnion('kind', [ExactQtySchema, RangeQtySchema, ChoiceQtySchema])
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
])

export type Condition = z.infer<typeof ConditionSchema>

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
    itemId: z.number().int().nonnegative(),
    name: z.string().min(1),
    qty: QtySpecSchema,
    noted: z.boolean().optional(),
  })
  .strict()

const TableRefNodeSchema = z
  .object({ kind: z.literal('tableRef'), ref: z.string().min(1) })
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
  })
  .strict()

export type Entry = z.infer<typeof EntrySchema>

// ---------------------------------------------------------------------------
// Tables (4.3)
// ---------------------------------------------------------------------------

export const TABLE_MODES = ['always', 'preroll', 'weighted', 'independent'] as const
export const TableModeSchema = z.enum(TABLE_MODES)
export type TableMode = z.infer<typeof TableModeSchema>

/** Rate kinds each mode's entries are allowed to use. */
const ALLOWED_ENTRY_RATES: Record<TableMode, readonly Rate['kind'][]> = {
  always: ['always'],
  preroll: ['fixed', 'formula'],
  weighted: ['weight'],
  independent: ['fixed', 'formula'],
}

export const TableSchema = z
  .object({
    id: z.string().min(1),
    mode: TableModeSchema,
    rolls: z.union([z.number().int().positive(), RateSchema]).default(1),
    denominator: z.number().finite().positive().optional(),
    withoutReplacement: z.boolean().default(false),
    entries: z.array(EntrySchema).min(1),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
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
