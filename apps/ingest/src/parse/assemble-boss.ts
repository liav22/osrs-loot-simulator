import {
  BossSchema,
  SharedTableSchema,
  type Boss,
  type Condition,
  type QtySpec,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { slugify } from '../snapshots/store.js'
import { indexByItemKey, type ItemIndex } from '../items/index.js'
import { isAllowlisted, type ItemAllowlist } from '../items/allowlist.js'
import type { ParsedEntry, ParsedTableGroup } from './build-tables.js'
import type { RdtAccessResult } from './rdt-access.js'

/**
 * Turns parsed table groups into a canonical `Boss` document. This is the
 * only module allowed to build a `Table`/`Node`/`Rate` literal from parsed
 * wiki data — everything upstream (`wikitext-drops.ts`, `build-tables.ts`)
 * stays in a parser-local shape so the canonical model's invariants
 * (zod `.strict()`, the mode/rate pairing refinements) are the single gate a
 * parsed boss has to pass.
 */

export interface AssembleOptions {
  slug: string
  title: string
  wikiRevId: number
  parserVersion: number
  itemIndex: ItemIndex
  allowlist: ItemAllowlist
  /** Corpus scope metadata, not derived here — see `inventory/repeatable.ts`. */
  repeatable: boolean
  /**
   * The loot source's own common name from `_inventory.json`'s `title`,
   * whenever it differs from `title` (the wiki drops-page name used above for
   * `name`/`wikiPage`) — e.g. "Chambers of Xeric" for the `Ancient chest`
   * drops page. Search matches `name` and `aliases` both (`fuzzy.ts`), so
   * without this a many-to-one source is only findable under its literal
   * chest/page name, which is not what a player searches for.
   */
  aliases: string[]
}

export interface AssembleResult {
  boss: Boss | null
  /** Zod or structural errors; non-empty means `boss` is null. */
  errors: string[]
  /** Item-resolution gaps. Redundant with `items_known`'s own failures, kept for the report. */
  warnings: string[]
  /**
   * Groups whose mode was a guess (`build-tables.ts`'s heuristic 5) rather than
   * a confident structural inference. Non-empty means the parser itself is not
   * sure of the table shape, which must block `verified` regardless of what
   * every other check says — a guess staying right by luck is not the same
   * thing as a check confirming it.
   */
  ambiguousGroups: string[]
  /**
   * `data/tables/<id>.json` records this document's `tableRef` nodes point at
   * — a confirmed co-drop bundle (`mode: 'always'`, one entry per member),
   * one file per bundle. Empty for every source that doesn't carry the bundle
   * shape. `parseBoss` writes each of these to disk and folds them into the
   * shared-tables map it validates this same document against, exactly the
   * way a hand-authored `data/tables/` record already works for RDT/gem/Lunar
   * Chest — this is generated, not hand-authored, but the mechanism is
   * identical. See docs/DECISIONS.md's "bundle shape, assessed" entry.
   */
  bundleTables: Table[]
}

function parseQuantity(raw: string): QtySpec {
  const cleaned = raw.replace(/\(noted\)/i, '').trim()
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(cleaned)
  if (range !== null) {
    return { kind: 'range', min: Number(range[1]), max: Number(range[2]) }
  }
  const n = Number(cleaned.replace(/,/g, ''))
  return { kind: 'exact', n: Number.isFinite(n) ? n : 1 }
}

/**
 * A page can split membership at either grain, and the two are genuinely
 * different mechanisms:
 *
 *  - **Per-row** (`{{(m)}}`/`{{(f)}}` namenotes markers — Brutus): most rows
 *    are unconditional and a handful carry their own marker.
 *  - **Section-level** (Obor/Bryophyta's own top-level
 *    `==Members' worlds drops==`/`==Free-to-play worlds drops==` split): every
 *    row in a section shares the SAME membership, and none of them carry a
 *    per-row marker at all, because the enclosing heading already says it.
 *
 * Before this, `conditionsFor` only read the per-row markers, so Obor and
 * Bryophyta's documents carried ZERO `members` conditions anywhere: every
 * simulated kill rolled BOTH sections' tables unconditionally regardless of
 * `ctx.members` — invisible for the whole project because neither source had
 * ever produced a document, and caught only once the heading-matching fix
 * (see `wikitext-drops.ts`) let them reach this far. See docs/DECISIONS.md.
 *
 * **A per-row marker wins over the section fallback.** It is the more
 * specific signal, and there is nothing in principle stopping a future page
 * from marking one row inside an otherwise-uniform section differently.
 *
 * **The section match is exact on the two confirmed phrases, not a broad
 * "contains 'member'" heuristic.** Checked directly: these are the only two
 * top-level Drops/Rewards section titles in the whole corpus mentioning
 * membership at all. Widening this needs a confirmed new heading first — the
 * same discipline the "Uniques" heading question has been held to throughout
 * this project (docs/DECISIONS.md's "What NOT to redo").
 */
const MEMBERS_SECTION_TITLE = /^members'?\s+worlds\s+drops$/i
const FREE_TO_PLAY_SECTION_TITLE = /^free-to-play\s+worlds\s+drops$/i

function conditionsFor(entry: ParsedEntry, section: string): Condition[] | undefined {
  const conditions: Condition[] = []
  if (entry.members) conditions.push({ kind: 'members', value: true })
  else if (entry.freeToPlay) conditions.push({ kind: 'members', value: false })
  else if (MEMBERS_SECTION_TITLE.test(section)) conditions.push({ kind: 'members', value: true })
  else if (FREE_TO_PLAY_SECTION_TITLE.test(section)) conditions.push({ kind: 'members', value: false })
  if (entry.extraConditions !== undefined) conditions.push(...entry.extraConditions)
  return conditions.length > 0 ? conditions : undefined
}

/**
 * Resolves an item name to `{ itemId, itemKey }`. `itemKey` is always the
 * slug of the wiki page name; `itemId` is null whenever the index does not
 * resolve to exactly one id and the key is not on the multi-id allowlist —
 * never a `0` sentinel.
 */
function resolveItem(
  name: string,
  itemIndex: ItemIndex,
  allowlist: ItemAllowlist,
  warnings: string[]
): { itemId: number | null; itemKey: string } {
  const itemKey = slugify(name)
  const byKey = indexByItemKey(itemIndex)
  const indexEntry = byKey.get(itemKey)

  if (indexEntry === undefined) {
    if (!isAllowlisted(allowlist, itemKey)) {
      warnings.push(`item '${name}' (key '${itemKey}') is not in the item index`)
    }
    return { itemId: null, itemKey }
  }
  if (indexEntry.itemId === null && !isAllowlisted(allowlist, itemKey)) {
    warnings.push(
      `item '${name}' (key '${itemKey}') resolves to ${indexEntry.rawIds.length} ids, ` +
        `not one (${JSON.stringify(indexEntry.rawIds)}), and is not on the multi-id allowlist`
    )
  }
  return { itemId: indexEntry.itemId, itemKey }
}

export function assembleBoss(
  groups: readonly ParsedTableGroup[],
  rdtAccess: RdtAccessResult,
  options: AssembleOptions
): AssembleResult {
  const errors: string[] = []
  const warnings: string[] = []
  const ambiguousGroups: string[] = []

  for (const group of groups) {
    if (group.ambiguous !== null) ambiguousGroups.push(group.ambiguous)
  }
  for (const unresolved of rdtAccess.unresolved) {
    ambiguousGroups.push(`RDT/gem-table access could not be modelled: ${unresolved.reason} (raw: '${unresolved.raw}')`)
  }

  // Every `variant`-kind condition this document actually uses, in the order
  // first encountered (so Normal Mode's own dropversion-tagged rows, which the
  // wiki always writes before Hard Mode's, land first). `Boss.variants` was
  // hardcoded to `['normal']` for every GENERATED document regardless of what
  // conditions its own entries carried — invisible for every source that had
  // one (black-demon's "Regular"/"Wilderness Slayer Cave", vorkath's/
  // amoxliatl's "Post-quest") since nothing ever surfaced a UI control for a
  // variant `boss.variants` never listed, the same "having the capability is
  // not the same as being reachable" lesson `docs/HANDOFF.md` already
  // recorded for `SimContext` fields. Collected from `extraConditions` here
  // (before groups become raw table-input objects) rather than by walking the
  // finished `tableInputs`, since the typed `Condition[]` shape is still
  // available at this point.
  const usedVariants = new Set<string>()
  for (const group of groups) {
    for (const entry of group.entries) {
      for (const condition of entry.extraConditions ?? []) {
        if (condition.kind === 'variant') usedVariants.add(condition.name)
      }
    }
  }
  for (const line of rdtAccess.lines) {
    if (line.variant !== null) usedVariants.add(line.variant)
  }
  const variants = usedVariants.size > 0 ? [...usedVariants] : ['normal']
  // `DEFAULT_SIM_CONTEXT.variant` is the literal string `'normal'`. A source
  // whose own variant values are wiki prose ("Normal Mode", "Hard Mode") never
  // matches that default, which would otherwise filter every variant-gated
  // entry out of the DEFAULT simulation — an empty table until a user
  // manually picks one from the dropdown. Defaulting to the first-seen value
  // instead keeps the default view non-empty; a source whose own value really
  // is `'normal'` needs no override at all.
  const contextDefaults = variants.includes('normal') ? {} : { variant: variants[0] }

  const itemNodeFor = (
    item: { name: string; quantity: string; noted: boolean },
    warnings: string[]
  ): Record<string, unknown> => {
    const { itemId, itemKey } = resolveItem(item.name, options.itemIndex, options.allowlist, warnings)
    return {
      kind: 'item' as const,
      itemId,
      itemKey,
      name: item.name,
      qty: parseQuantity(item.quantity),
      ...(item.noted ? { noted: true } : {}),
    }
  }

  // One `data/tables/<id>.json` per confirmed bundle, plus the `tableRef` id
  // counter that names it. Ids are derived from the boss slug and the
  // bundle's own heading — filename-safe and greppable, matching
  // `data/tables/`'s existing `lunar_chest_*_set` precedent — with a numeric
  // suffix for the rare case of two bundles under one heading (K'ril/
  // Zilyana's two potion pairs both sit under "Potions").
  const bundleTables: Table[] = []
  const bundleIdCounts = new Map<string, number>()

  const nodeFor = (entry: ParsedEntry, warnings: string[]): Record<string, unknown> => {
    if (entry.bundle === undefined) return itemNodeFor(entry, warnings)

    const base = `${options.slug}-${slugify(entry.bundle.heading)}-bundle`
    const seen = (bundleIdCounts.get(base) ?? 0) + 1
    bundleIdCounts.set(base, seen)
    const id = seen === 1 ? base : `${base}-${seen}`

    const table = {
      id,
      mode: 'always' as const,
      entries: entry.bundle.members.map((member) => ({
        node: itemNodeFor(member, warnings),
        rate: { kind: 'always' as const },
      })),
      notes:
        `Co-drop bundle for ${options.title}'s "${entry.bundle.heading}" heading — ` +
        `${entry.bundle.signal}. Every member arrives on the same access roll; see ` +
        `docs/DECISIONS.md's "bundle shape, assessed" entry.`,
    }
    const parsedTable = SharedTableSchema.safeParse(table)
    if (!parsedTable.success) {
      for (const issue of parsedTable.error.issues) {
        errors.push(`bundle table '${id}': ${issue.path.join('.')}: ${issue.message}`)
      }
    } else {
      bundleTables.push(parsedTable.data)
    }
    return { kind: 'tableRef' as const, ref: id }
  }

  const noteFor = (group: ParsedTableGroup): string =>
    group.confirmedBy !== undefined
      ? `${group.headings.join(' / ')} (confirmed ${group.mode}: ${group.confirmedBy})`
      : group.headings.join(' / ')

  const tableInputs: unknown[] = groups
    .filter((group) => group.entries.length > 0)
    .map((group, index) => {
      const tableId = `${options.slug}:${index}:${slugify(group.headings.join('-'))}`

      // A confirmed transcluded partition: one `oneOf` node, at the block's
      // own declared access rate, wrapping every row instead of N
      // independently-rolled entries. `oneOf` entries are schema-required to
      // carry a `weight` rate — each row's own published probability IS its
      // relative share of the pool, since the partition identity already
      // confirmed these rows sum to the access rate this entry sits behind,
      // so no rescaling is needed for the proportions to come out right.
      if (group.oneOfAccess !== undefined) {
        const oneOfEntries = group.entries.map((entry) => {
          const conditions = conditionsFor(entry, group.section)
          return {
            node: itemNodeFor(entry, warnings),
            rate: { kind: 'weight' as const, weight: entry.rarity.num / entry.rarity.den },
            ...(conditions ? { conditions } : {}),
          }
        })

        return {
          id: tableId,
          mode: group.mode,
          entries: [
            {
              node: { kind: 'oneOf' as const, entries: oneOfEntries },
              rate: { kind: 'fixed' as const, num: group.oneOfAccess.num, den: group.oneOfAccess.den },
            },
          ],
          notes: noteFor(group),
        }
      }

      const entries = group.entries.map((entry) => {
        const node = nodeFor(entry, warnings)
        const conditions = conditionsFor(entry, group.section)
        if (group.mode === 'weighted') {
          return {
            node,
            rate: { kind: 'weight' as const, weight: entry.weight ?? entry.rarity.num },
            ...(conditions ? { conditions } : {}),
          }
        }
        if (entry.rarity.kind === 'always') {
          return { node, rate: { kind: 'always' as const }, ...(conditions ? { conditions } : {}) }
        }
        return {
          node,
          rate: { kind: 'fixed' as const, num: entry.rarity.num, den: entry.rarity.den },
          ...(conditions ? { conditions } : {}),
        }
      })

      return {
        id: tableId,
        mode: group.mode,
        entries,
        notes: noteFor(group),
        ...(group.mode === 'weighted' && group.denominator !== null
          ? { denominator: group.denominator }
          : {}),
      }
    })

  // Which template call produced a given `ref` — `rare_drop_table`/
  // `gem_drop_table` come from `{{RareDropTable}}`/`{{GemDropTable}}`
  // (including the RDT's own optional second, direct gem-access param); the
  // two `gwd_*` refs both come from the single, parameterless `{{GWDRDT}}`.
  const ACCESS_TEMPLATE_NAME: Record<(typeof rdtAccess.lines)[number]['ref'], string> = {
    rare_drop_table: 'RareDropTable',
    gem_drop_table: 'GemDropTable',
    gwd_rare_drop_table: 'GWDRDT',
    gwd_gem_drop_table: 'GWDRDT',
  }

  rdtAccess.lines.forEach((line, index) => {
    const notes = [
      `Access into ${line.ref} (from {{${ACCESS_TEMPLATE_NAME[line.ref]}}})`,
      line.approx ? 'approximate rate per the wiki' : null,
      line.qtyMultiplier !== null
        ? `wiki states multiplier=${line.qtyMultiplier}: every quantity from this access is scaled by it`
        : null,
      line.drawsPerHit !== null
        ? `one access check draws the table ${line.drawsPerHit} times (per the wiki's own prose), ` +
          'not the usual N independent access attempts'
        : null,
    ]
      .filter((note): note is string => note !== null)
      .join('; ')

    tableInputs.push({
      id: `${options.slug}:rdt-access:${index}`,
      mode: 'independent',
      rolls: line.rolls,
      entries: [
        {
          node: {
            kind: 'tableRef' as const,
            ref: line.ref,
            ...(line.qtyMultiplier !== null ? { qtyMultiplier: line.qtyMultiplier } : {}),
            ...(line.drawsPerHit !== null ? { drawsPerHit: line.drawsPerHit } : {}),
          },
          rate: { kind: 'fixed' as const, num: line.rate.num, den: line.rate.den },
          ...(line.variant !== null ? { conditions: [{ kind: 'variant' as const, name: line.variant }] } : {}),
        },
      ],
      notes,
    })
  })

  const input = {
    slug: options.slug,
    name: options.title,
    aliases: options.aliases,
    wikiPage: options.title,
    wikiRevId: options.wikiRevId,
    variants,
    status: 'needs_review',
    // Overwritten by `parse-boss.ts` once `deriveStatusTier` has the real
    // `validation.checks` to read — placeholders only so this intermediate
    // parse (before status/validation are known) satisfies the schema.
    statusTier: null,
    statusReason: null,
    source: 'generated',
    parserVersion: options.parserVersion,
    contextDefaults,
    validation: { ok: false, checks: [] },
    tables: tableInputs,
    repeatable: options.repeatable,
  }

  const parsed = BossSchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`)
    }
    return { boss: null, errors, warnings, ambiguousGroups, bundleTables }
  }

  return { boss: parsed.data, errors, warnings, ambiguousGroups, bundleTables }
}
