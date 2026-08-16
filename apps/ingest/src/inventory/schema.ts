import { z } from 'zod'
import { TIERS } from '../triage/classify.js'

/**
 * `data/_inventory.json` — the boss-to-loot-source map.
 *
 * A boss page and a loot source are not the same thing. Six Barrows brothers
 * share one chest; seven Chambers of Xeric bosses contribute to one raid
 * reward. The mapping is therefore many-to-one, and the project's unit of work
 * is the loot source, not the page.
 *
 * This file lives under `data/` and is CC BY-NC-SA 3.0 like everything derived
 * from the wiki.
 */

export const INVENTORY_VERSION = 1

/** How a boss page's drops were located. */
export const CLASSIFICATIONS = [
  /** The page carries its own main weighted table. */
  'own-table',
  /** Part of an encounter whose loot is on a separate reward page. */
  'reward-page',
  /** Its whole drop table is a handful of Always rows. Complete as-is. */
  'trivial',
  /** Part of an encounter with no drop rows anywhere — point-based rewards. */
  'component',
  /** No drop rows, no encounter, no reward page. Hub and meta pages. */
  'no-loot-data',
] as const

export const ClassificationSchema = z.enum(CLASSIFICATIONS)
export type Classification = z.infer<typeof ClassificationSchema>

/** Classifications that contribute a simulable loot source. */
export const INCLUDED_CLASSIFICATIONS: readonly Classification[] = [
  'own-table',
  'reward-page',
  'trivial',
]

export const BossEntrySchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    pageid: z.number().int().nonnegative(),
    revid: z.number().int().nonnegative().nullable(),
    /** Many-to-one: several bosses may share one loot source. */
    lootSourceId: z.string().min(1),
    classification: ClassificationSchema,
    tier: z.enum(TIERS),
    rowCount: z.number().int().nonnegative(),
    /** The activity page this boss belongs to, when it is part of one. */
    encounter: z.string().nullable(),
    /**
     * Whether the same account can fight this specific page's encounter more
     * than once. Derived from `Category:Quest monsters`/`Category:Quest NPCs`
     * membership, corrected by `data/repeatable-overrides.json` for the rare
     * case the category over-fires (a quest unlocks access to an otherwise
     * ordinary, persistent boss — e.g. Vorkath). See `build.ts`'s
     * `deriveRepeatable`.
     */
    repeatable: z.boolean(),
  })
  .strict()

export type BossEntry = z.infer<typeof BossEntrySchema>

export const LootSourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    /** Page the drop rows actually come from, when it differs from `title`. */
    dropsPage: z.string().min(1),
    tier: z.enum(TIERS),
    rowCount: z.number().int().nonnegative(),
    /** Whether this source counts toward the parser gate. */
    include: z.boolean(),
    excludeReason: z.string().nullable(),
    /** Boss slugs that resolve to this source. */
    bosses: z.array(z.string().min(1)).min(1),
    /**
     * True if ANY constituent boss page offers repeated access — an
     * aggregated encounter (Barrows, a raid) is repeatable the moment one of
     * its member pages is, which every real case in the corpus already is.
     */
    repeatable: z.boolean(),
  })
  .strict()

export type LootSource = z.infer<typeof LootSourceSchema>

export const InventorySchema = z
  .object({
    inventoryVersion: z.literal(INVENTORY_VERSION),
    generatedAt: z.string(),
    category: z.string(),
    bosses: z.array(BossEntrySchema),
    lootSources: z.array(LootSourceSchema),
  })
  .strict()
  .superRefine((inventory, ctx) => {
    const ids = new Set(inventory.lootSources.map((source) => source.id))
    inventory.bosses.forEach((boss, i) => {
      if (!ids.has(boss.lootSourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `boss '${boss.slug}' points at unknown lootSourceId '${boss.lootSourceId}'`,
          path: ['bosses', i, 'lootSourceId'],
        })
      }
    })
  })

export type Inventory = z.infer<typeof InventorySchema>
