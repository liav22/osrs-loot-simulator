import {
  CircularTableRefError,
  compileBoss,
  WeightsExceedDenominatorError,
  resolveSimContext,
  UnresolvedTableRefError,
  type Boss,
  type Node,
  type Table,
} from '@osrs-loot-simulator/loot-model'

/**
 * The `refs_resolve` check (PROJECT_PLAN.md 7): "Every `tableRef` resolves and
 * the graph is acyclic."
 *
 * That is a **structural** property of the document, and this check used to
 * treat it as a runtime one. The whole implementation was a `compileBoss` call
 * against `resolveSimContext(boss, {})`, on the reasoning that reusing the
 * simulator's own resolution path means only one place decides whether a ref
 * resolves. The reasoning was good; the scope it produced was not, and the
 * scope was decided by a field nothing here validated: **`SimContext`**.
 *
 * `compileTable` filters out condition-excluded entries *before* resolving
 * anything they point at. So a `tableRef` sitting behind a condition that is
 * false under the boss's own defaults is never resolved, and the check reported
 * `ok: true` for it. This was not hypothetical: Lunar Chest's three
 * `lunar_chest_*_set` refs are each gated on an `includes` condition over
 * `moonsKilled`, which defaults to empty, so `checkRefsResolve(lunarChest,
 * new Map())` returned **`ok: true, "resolved against 0 shared table(s)"`** —
 * a clean pass with literally nothing resolved. The same blind spot shipped in
 * the frontend, where the browser's shared-table fetch list had gone stale and
 * every Lunar Chest run with a Moon selected threw `UnresolvedTableRefError`
 * out of the worker.
 *
 * So resolution is now decided by a structural walk of the document that
 * ignores conditions entirely, and `compileBoss` is kept behind it as a
 * cross-check that the real resolution path agrees on the subgraph it can see.
 * The walk also closes two narrower gaps in the old version:
 *
 *  - It descends into `oneOf` nodes. `LeafNodeSchema` admits `tableRef`, so a
 *    ref nested one level down was structurally possible and completely
 *    invisible to the old `boss.tables.some(t => t.entries.some(...))`
 *    short-circuit, which would answer "no tableRef nodes" for a document that
 *    had one. No source in the corpus does this today; the schema allows it.
 *  - It follows refs transitively through `data/tables/`, so a shared table
 *    pointing at a record that is not present fails here rather than at
 *    simulate time.
 */

export interface RefsResolveResult {
  check: 'refs_resolve'
  ok: boolean
  detail: string
}

interface Walk {
  shared: ReadonlyMap<string, Table>
  missing: Set<string>
  cycles: string[]
  /** Tables on the current DFS path — a repeat means a cycle. */
  visiting: Set<string>
  /** Tables fully explored — a repeat is just a diamond, not a cycle. */
  done: Set<string>
  found: number
}

function walkNode(node: Node, walk: Walk, path: readonly string[]): void {
  if (node.kind === 'oneOf') {
    for (const entry of node.entries) walkNode(entry.node, walk, path)
    return
  }
  if (node.kind !== 'tableRef') return

  walk.found += 1
  const target = walk.shared.get(node.ref)
  if (target === undefined) {
    walk.missing.add(node.ref)
    return
  }
  if (walk.visiting.has(node.ref)) {
    walk.cycles.push([...path, node.ref].join(' -> '))
    return
  }
  if (walk.done.has(node.ref)) return

  walk.visiting.add(node.ref)
  walkTable(target, walk, [...path, node.ref])
  walk.visiting.delete(node.ref)
  walk.done.add(node.ref)
}

function walkTable(table: Table, walk: Walk, path: readonly string[]): void {
  // Deliberately does NOT consult `entry.conditions`. Whether a ref is
  // reachable in some particular run is a different question from whether the
  // document it lives in is complete, and only the second one is this check's.
  for (const entry of table.entries) walkNode(entry.node, walk, path)
}

export function checkRefsResolve(
  boss: Boss,
  sharedTables: ReadonlyMap<string, Table>
): RefsResolveResult {
  const walk: Walk = {
    shared: sharedTables,
    missing: new Set(),
    cycles: [],
    visiting: new Set(),
    done: new Set(),
    found: 0,
  }
  for (const table of boss.tables) walkTable(table, walk, [table.id])

  if (walk.found === 0) {
    return { check: 'refs_resolve', ok: true, detail: 'no tableRef nodes' }
  }
  if (walk.missing.size > 0) {
    const names = [...walk.missing].sort().join(', ')
    return {
      check: 'refs_resolve',
      ok: false,
      detail: `unresolved tableRef(s): ${names}`,
    }
  }
  if (walk.cycles.length > 0) {
    return { check: 'refs_resolve', ok: false, detail: `Circular tableRef: ${walk.cycles[0]}` }
  }

  // Cross-check against the real resolution path. The structural walk above
  // covers a superset of what this can reach, so this should never be the
  // thing that fails — if it ever is, the two have diverged and that is worth
  // knowing loudly rather than trusting the walk alone.
  try {
    compileBoss(boss, resolveSimContext(boss, {}), { tables: sharedTables })
  } catch (error) {
    if (error instanceof UnresolvedTableRefError || error instanceof CircularTableRefError) {
      return { check: 'refs_resolve', ok: false, detail: error.message }
    }
    // A document can fail to COMPILE for reasons that are nothing to do with
    // tableRefs — most commonly weights exceeding their denominator, which is
    // `weights_sum`'s failure to report and which it reports properly. Before
    // this, that error escaped here and aborted the whole parse run: one tier-D
    // source with an overflowing table took 22 others down with it.
    //
    // Reported rather than swallowed. `ok: true` is the honest verdict — the
    // structural walk above resolved every ref, which is what this check is
    // for — but the detail says the cross-check could not run and why, instead
    // of claiming a clean pass it did not earn. Same discipline as
    // `drops_covered` announcing "no dropsline snapshot; coverage not checked".
    if (error instanceof WeightsExceedDenominatorError) {
      return {
        check: 'refs_resolve',
        ok: true,
        detail:
          `${walk.found} tableRef node(s) resolved structurally against ${sharedTables.size} ` +
          `shared table(s); the compileBoss cross-check could not run because the document ` +
          `does not compile (${error.message}) — weights_sum owns that failure`,
      }
    }
    throw error
  }

  return {
    check: 'refs_resolve',
    ok: true,
    detail: `${walk.found} tableRef node(s) resolved against ${sharedTables.size} shared table(s)`,
  }
}
