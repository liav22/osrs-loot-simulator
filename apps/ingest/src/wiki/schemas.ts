import { z } from 'zod'
import { DROP_JSON_FIELDS } from './fields.js'

/**
 * Zod at the boundary (PROJECT_PLAN.md 6.1). Envelopes are strict so a shape
 * change fails loudly. The `drop_json` blob is passthrough-checked instead:
 * unknown keys there are recorded as drift and reported, because a single new
 * cosmetic key should not abort a 172-page fetch.
 */

export const BucketResponseSchema = z
  .object({
    bucketQuery: z.string(),
    bucket: z.array(z.record(z.unknown())).optional(),
    error: z.string().optional(),
  })
  .strict()

export type BucketResponse = z.infer<typeof BucketResponseSchema>

export const DropslineRowSchema = z
  .object({
    page_name: z.string(),
    item_name: z.string().nullable(),
    drop_json: z.string(),
    rare_drop_table: z.boolean().nullable(),
  })
  .strict()

export type DropslineRow = z.infer<typeof DropslineRowSchema>

const numericish = z.union([z.number(), z.string()]).nullable().optional()

export const DropJsonSchema = z
  .object({
    [DROP_JSON_FIELDS.droppedFrom]: z.string().optional(),
    [DROP_JSON_FIELDS.droppedItem]: z.string().optional(),
    [DROP_JSON_FIELDS.rarity]: z.string().optional(),
    [DROP_JSON_FIELDS.altRarity]: z.string().optional(),
    [DROP_JSON_FIELDS.altRarityDash]: z.string().optional(),
    [DROP_JSON_FIELDS.approx]: z.boolean().optional(),
    [DROP_JSON_FIELDS.rolls]: numericish,
    [DROP_JSON_FIELDS.dropQuantity]: numericish,
    [DROP_JSON_FIELDS.quantityLow]: numericish,
    [DROP_JSON_FIELDS.quantityHigh]: numericish,
    [DROP_JSON_FIELDS.dropValue]: numericish,
    [DROP_JSON_FIELDS.dropLevel]: numericish,
    [DROP_JSON_FIELDS.dropType]: z.string().optional(),
    [DROP_JSON_FIELDS.nameNotes]: z.string().optional(),
    [DROP_JSON_FIELDS.rarityNotes]: z.string().optional(),
    [DROP_JSON_FIELDS.leagueRegion]: z.string().optional(),
  })
  .passthrough()

export type DropJson = z.infer<typeof DropJsonSchema>

export const CategoryMembersResponseSchema = z.object({
  query: z.object({
    categorymembers: z.array(
      z.object({ pageid: z.number(), ns: z.number(), title: z.string() }).strict()
    ),
  }),
  continue: z.object({ cmcontinue: z.string() }).passthrough().optional(),
  batchcomplete: z.union([z.boolean(), z.string()]).optional(),
})

export const RevisionsResponseSchema = z.object({
  query: z.object({
    pages: z.array(
      z
        .object({
          pageid: z.number().optional(),
          ns: z.number().optional(),
          title: z.string(),
          missing: z.boolean().optional(),
          revisions: z
            .array(z.object({ revid: z.number(), timestamp: z.string() }).passthrough())
            .optional(),
        })
        .passthrough()
    ),
    normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  }),
  batchcomplete: z.union([z.boolean(), z.string()]).optional(),
})

export const ParseWikitextResponseSchema = z.object({
  parse: z.object({
    title: z.string(),
    pageid: z.number(),
    wikitext: z.string(),
  }),
})

/** Snapshot envelope written to `data/snapshots/` (6.3). */
export const SNAPSHOT_VERSION = 1

export const SnapshotSchema = z
  .object({
    snapshotVersion: z.literal(SNAPSHOT_VERSION),
    fetchedAt: z.string(),
    userAgent: z.string(),
    endpoint: z.string(),
    params: z.record(z.string()),
    httpStatus: z.number().int(),
    /** Verbatim parsed response body. Never post-processed before writing. */
    body: z.unknown(),
  })
  .strict()

export type Snapshot = z.infer<typeof SnapshotSchema>
