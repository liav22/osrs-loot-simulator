import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  PartialSimContextSchema,
  TableSchema,
  type BossInput,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../snapshots/store.js'

/**
 * Hand-authored overrides (PROJECT_PLAN.md 3, 16's Phase 5).
 *
 * Some loot sources cannot be reached by the parser at all — not because the
 * parser is weak, but because the wiki never encoded the mechanic in
 * `{{DropsLine}}` rows. Chambers of Xeric's Ancient chest states its unique
 * roll in prose under a `==Loot table==` heading; Fortis Colosseum's rewards
 * are structured by `Wave 1`..`Wave 12` headings that fit no canonical mode;
 * Doom of Mokhaiotl's per-delve-level scaling lives in a Mechanics table, not
 * in any drop row. For these, a human writes the tables and this module
 * merges them over whatever the parser managed.
 *
 * Deliberately NOT a way to paper over parser bugs. If the parser CAN read a
 * page and gets it wrong, fix the parser (and re-parse from
 * `data/snapshots/`, per CLAUDE.md's hard rule) rather than pinning the wrong
 * answer in place with an override.
 */
export const OVERRIDES_DIR = join(REPO_ROOT, 'data', 'overrides')

export const BossOverrideSchema = z
  .object({
    /** Must match the file name and the loot source's own slug. */
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
    /**
     * Why this override exists, in prose. Required, and required to be
     * substantial: an override silently replacing generated data is exactly
     * the kind of thing a future session must be able to audit without
     * re-deriving the reasoning. Cite the wiki section it came from.
     */
    note: z.string().min(30),
    name: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    wikiPage: z.string().min(1).optional(),
    wikiRevId: z.number().int().nonnegative().optional(),
    variants: z.array(z.string().min(1)).min(1).optional(),
    /** Replaces the generated tables WHOLESALE when present — never merged per-table. */
    tables: z.array(TableSchema).optional(),
    contextDefaults: PartialSimContextSchema.optional(),
  })
  .strict()

export type BossOverride = z.infer<typeof BossOverrideSchema>

export class OverrideSlugMismatchError extends Error {
  constructor(fileSlug: string, declaredSlug: string) {
    super(
      `data/overrides/${fileSlug}.json declares slug '${declaredSlug}'; ` +
        'the file name and the slug field must match'
    )
    this.name = 'OverrideSlugMismatchError'
  }
}

/** The override for one slug, or null when none is authored. */
export async function loadOverride(slug: string): Promise<BossOverride | null> {
  let raw: string
  try {
    raw = await readFile(join(OVERRIDES_DIR, `${slug}.json`), 'utf8')
  } catch {
    return null
  }
  const parsed = BossOverrideSchema.parse(JSON.parse(raw))
  if (parsed.slug !== slug) throw new OverrideSlugMismatchError(slug, parsed.slug)
  return parsed
}

/** Every authored override slug, for reporting and for the consistency check. */
export async function listOverrideSlugs(): Promise<string[]> {
  try {
    const files = await readdir(OVERRIDES_DIR)
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort()
  } catch {
    return []
  }
}

/**
 * Applies an override over a generated document.
 *
 * `tables` replaces wholesale rather than merging per-table id, on purpose:
 * the sources needing an override need a different *shape*, not a patched
 * row, and a per-table merge would quietly leave a stale generated table
 * behind whenever a hand-authored one renamed it. All-or-nothing is auditable;
 * partial is not.
 *
 * `source` distinguishes the two real cases, using the enum PROJECT_PLAN.md
 * 4.5 already defined and nothing had used until now:
 * - `'override'` — there was no generated document to merge with (the parser
 *   could not reach the page at all).
 * - `'merged'` — generated data survived underneath the override's fields.
 */
export function applyOverride(
  generated: BossInput | null,
  override: BossOverride,
  parserVersion: number,
  /**
   * Corpus scope metadata from `_inventory.json`, not an override-authored
   * field — an override changes how a source's mechanic is MODELLED, never
   * whether the account can get more than one roll against it, so this is
   * always supplied externally and always wins over whatever `generated`
   * carried (which, when non-null, already carries the same value).
   */
  repeatable: boolean
): BossInput {
  // `slug` is set explicitly below and `note` is documentation for humans
  // reading data/overrides/ (surfaced in the parse report via
  // `overrideSummary`) — neither is a Boss field, so both are dropped here.
  const { slug } = override
  const defined = Object.fromEntries(
    Object.entries(override).filter(
      ([k, v]) => v !== undefined && k !== 'slug' && k !== 'note'
    )
  )

  if (generated === null) {
    const missing = ['name', 'wikiPage', 'wikiRevId', 'tables'].filter((k) => !(k in defined))
    if (missing.length > 0) {
      throw new Error(
        `data/overrides/${slug}.json must supply ${missing.join(', ')}: ` +
          'there is no generated document to inherit them from'
      )
    }
  }

  // With no generated document there is nothing to inherit the pipeline's own
  // bookkeeping fields from, so they are supplied here. `status` and
  // `validation` are placeholders: `parseBoss` overwrites both once the
  // merged document has actually been checked — an override never gets to
  // declare its own validation result.
  const base: Partial<BossInput> =
    generated ?? {
      aliases: [],
      variants: ['normal'],
      contextDefaults: {},
      parserVersion,
      status: 'needs_review',
      statusTier: null,
      statusReason: null,
      validation: { ok: false, checks: [] },
    }
  return {
    ...base,
    ...defined,
    slug,
    source: generated === null ? 'override' : 'merged',
    repeatable,
  } as BossInput
}

/** Human-readable provenance line appended to the parse report. */
export function overrideSummary(override: BossOverride, generatedExisted: boolean): string {
  const replaced = override.tables === undefined ? 'metadata only' : `${override.tables.length} table(s)`
  return `override applied (${generatedExisted ? 'merged' : 'override'}, ${replaced}): ${override.note}`
}
