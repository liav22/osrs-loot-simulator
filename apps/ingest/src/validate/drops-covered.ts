import type { Node, Table } from '@osrs-loot-simulator/loot-model'
import { BucketResponseSchema } from '../wiki/schemas.js'
import { readSnapshot, slugify } from '../snapshots/store.js'

/**
 * The `drops_covered` check: every item the wiki lists as dropping from this
 * source appears somewhere in the parsed document.
 *
 * ## The gap this closes
 *
 * Every other check is **closed-world over the extracted document** — they
 * validate the weights, rates, quantities, refs and item ids that ARE there.
 * None of them compares the extraction against the page it came from, so a
 * drop table that produced zero rows is indistinguishable from one that never
 * existed.
 *
 * That is not hypothetical. `extractDropLines` reads `{{DropsLine}}` calls out
 * of page wikitext, and a section whose body is a TRANSCLUSION has none:
 *
 * ```
 * ===Sigils===
 * {{Uniques/Corporeal Beast}}
 * ```
 *
 * Corporeal Beast shipped `verified` with all three sigils missing, and it is
 * not alone — 26 transcluded drop sub-tables across 21 sources, covering every
 * seed on Vorkath and the Dagannoths, the herb and talisman sub-tables, and
 * `WildernessSlayerDropTable`'s Larran's key / Slayer's enchantment. Corp's own
 * 512-denominator table sums flush WITHOUT the sigils (they are a separate
 * 1/585 roll), so `weights_sum` could never have noticed.
 *
 * ## Why the dropsline bucket is the right oracle
 *
 * It is a different view of the same page, produced by the wiki itself from
 * the rendered drop tables — so it sees through transclusions that the raw
 * wikitext hides. It is already snapshotted for every source
 * (`data/snapshots/dropsline/`), so this check is offline and needs no fetch.
 *
 * ## Direction, and what is deliberately NOT asserted
 *
 * Coverage only, in one direction: every bucket item must be reachable in the
 * document. The reverse is not required and must not be — a document
 * legitimately carries items the bucket does not list (override-authored
 * sources like Lunar Chest and Reward pool build their tables from prose the
 * bucket never saw).
 *
 * `tableRef` contents COUNT as covered. A boss that reaches the rare drop table
 * really does drop everything in it, and the shared record is validated as
 * itself — re-blaming its contents on each of seventeen referencing sources is
 * the same mistake `collectItemInputs` documents avoiding.
 */

export interface DropsCoveredResult {
  check: 'drops_covered'
  ok: boolean
  detail?: string
  /** Item names the wiki lists that the document does not reach. */
  missing: string[]
}

/** Item names reachable in a document, following `tableRef` through shared records. */
export function reachableItemNames(
  tables: readonly Table[],
  sharedTables: ReadonlyMap<string, Table>
): Set<string> {
  const names = new Set<string>()
  const visitedRefs = new Set<string>()

  const visitNode = (node: Node): void => {
    switch (node.kind) {
      case 'item':
        names.add(node.name)
        return
      case 'oneOf':
        for (const entry of node.entries) visitNode(entry.node)
        return
      case 'tableRef': {
        // Guarded against cycles: `rare_drop_table` reaches the gem table,
        // which reaches mega-rare, and a future record could close the loop.
        if (visitedRefs.has(node.ref)) return
        visitedRefs.add(node.ref)
        const target = sharedTables.get(node.ref)
        if (target !== undefined) visitTable(target)
        return
      }
      case 'nothing':
        return
    }
  }

  const visitTable = (table: Table): void => {
    for (const entry of table.entries) visitNode(entry.node)
  }

  for (const table of tables) visitTable(table)
  return names
}

/**
 * Names the bucket lists that no document could reasonably be expected to
 * carry as an item node.
 *
 * Kept deliberately tiny and explicit. A growing exception list is how a
 * coverage check turns back into a check that passes because it stopped
 * looking — the fourth scope-permissive guard's exact failure mode.
 */
const NOT_ITEM_NODES = new Set([
  // A `nothing`-kind outcome, not an item. The parser models it as the
  // weighted table's implicit remainder rather than a node with a name.
  'Nothing',
])

/**
 * Names a bucket row may be recorded under, any one of which counts as covered.
 *
 * The bucket sometimes names a versioned item by its **page anchor** —
 * `Pendant of ates#Inert` — where the document, the item index and the wiki's
 * own display name all use the parenthesised form, `Pendant of ates (inert)`.
 * That is a naming convention, not a missing drop, and treating it as one would
 * fail Amoxliatl for an item it demonstrably carries.
 *
 * Deliberately narrow: it translates one documented wiki convention, rather
 * than fuzzy-matching names. Exactly one row in the whole corpus takes this
 * path today (`Pendant of ates#Inert` on Amoxliatl), and if that number ever
 * grows a lot, the right response is to look at why — not to loosen the match.
 */
function coverageCandidates(bucketName: string): string[] {
  const hash = bucketName.indexOf('#')
  if (hash === -1) return [bucketName]
  const base = bucketName.slice(0, hash)
  const anchor = bucketName.slice(hash + 1)
  return [bucketName, base, `${base} (${anchor.toLowerCase()})`]
}

/**
 * The check itself, with the snapshot read lifted out.
 *
 * Split from `checkDropsCovered` so the verdict is a pure function of
 * (bucket names, tables, shared tables). That is what lets the scope-invariant
 * harness — which takes a synchronous `verdict` — cover this check like the
 * other five, rather than this being the one check the harness cannot reach.
 *
 * `bucketNames === null` means no oracle was available, and it passes. That is
 * right: the check exists to catch a document smaller than its page, and with
 * no page to compare against there is no claim to make. It is stated in the
 * detail string rather than left silent, so a pass here is never mistaken for
 * a coverage-verified one — the same discipline `refs_resolve` learned when it
 * reported "resolved against 0 shared table(s)" as a clean pass.
 */
export function checkDropsCoveredAgainst(
  bucketNames: readonly string[] | null,
  tables: readonly Table[],
  sharedTables: ReadonlyMap<string, Table>,
  title = 'this source'
): DropsCoveredResult {
  if (bucketNames === null) {
    return {
      check: 'drops_covered',
      ok: true,
      detail: `no dropsline snapshot for '${title}'; coverage not checked`,
      missing: [],
    }
  }

  const reachable = reachableItemNames(tables, sharedTables)
  const distinct = new Set(bucketNames)
  const missing = [...distinct]
    .filter(
      (name) =>
        !NOT_ITEM_NODES.has(name) &&
        !coverageCandidates(name).some((candidate) => reachable.has(candidate))
    )
    .sort()

  return {
    check: 'drops_covered',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `all ${distinct.size} wiki drop row(s) reachable in the document`
        : `${missing.length} of ${distinct.size} wiki drop row(s) missing from the document: ` +
          `${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8} more)` : ''}`,
    missing,
  }
}

/** Item names the wiki's own drop bucket lists for a page, or null if not snapshotted. */
export async function bucketItemNames(title: string): Promise<string[] | null> {
  try {
    const snapshot = await readSnapshot('dropsline', slugify(title))
    const parsed = BucketResponseSchema.parse(snapshot.body)
    return (parsed.bucket ?? [])
      .map((row) => row.item_name)
      .filter((name): name is string => typeof name === 'string' && name !== '')
  } catch {
    return null
  }
}

export async function checkDropsCovered(
  title: string,
  tables: readonly Table[],
  sharedTables: ReadonlyMap<string, Table>
): Promise<DropsCoveredResult> {
  return checkDropsCoveredAgainst(await bucketItemNames(title), tables, sharedTables, title)
}
