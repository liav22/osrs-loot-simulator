import { BossSchema, type Boss, type Condition, type QtySpec } from '@osrs-loot-simulator/loot-model'
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

function conditionsFor(entry: ParsedEntry): Condition[] | undefined {
  const conditions: Condition[] = []
  if (entry.members) conditions.push({ kind: 'members', value: true })
  else if (entry.freeToPlay) conditions.push({ kind: 'members', value: false })
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

  const tableInputs: unknown[] = groups
    .filter((group) => group.entries.length > 0)
    .map((group, index) => {
      const tableId = `${options.slug}:${index}:${slugify(group.headings.join('-'))}`
      const entries = group.entries.map((entry) => {
        const { itemId, itemKey } = resolveItem(entry.name, options.itemIndex, options.allowlist, warnings)
        const node = {
          kind: 'item' as const,
          itemId,
          itemKey,
          name: entry.name,
          qty: parseQuantity(entry.quantity),
          ...(entry.noted ? { noted: true } : {}),
        }
        const conditions = conditionsFor(entry)
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
        notes:
          group.confirmedBy !== undefined
            ? `${group.headings.join(' / ')} (confirmed ${group.mode}: ${group.confirmedBy})`
            : group.headings.join(' / '),
        ...(group.mode === 'weighted' && group.denominator !== null
          ? { denominator: group.denominator }
          : {}),
      }
    })

  rdtAccess.lines.forEach((line, index) => {
    const notes = [
      `Access into ${line.ref} (from {{${line.ref === 'rare_drop_table' ? 'RareDropTable' : 'GemDropTable'}}})`,
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
    aliases: [],
    wikiPage: options.title,
    wikiRevId: options.wikiRevId,
    variants: ['normal'],
    status: 'needs_review',
    source: 'generated',
    parserVersion: options.parserVersion,
    contextDefaults: {},
    validation: { ok: false, checks: [] },
    tables: tableInputs,
  }

  const parsed = BossSchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`)
    }
    return { boss: null, errors, warnings, ambiguousGroups }
  }

  return { boss: parsed.data, errors, warnings, ambiguousGroups }
}
