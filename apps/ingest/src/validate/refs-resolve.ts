import {
  CircularTableRefError,
  compileBoss,
  resolveSimContext,
  UnresolvedTableRefError,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'

/**
 * The `refs_resolve` check. Tier A/B sources have no `tableRef` nodes at all,
 * so this trivially passes for them. Tier C sources reference the shared
 * `data/tables/*.json` records built in Phase 3 — this reuses the exact same
 * resolution path the real simulator runs (`compileBoss`), rather than
 * duplicating the walk, so there is only ever one place that decides whether
 * a `tableRef` resolves.
 */
export function checkRefsResolve(
  boss: Boss,
  sharedTables: ReadonlyMap<string, Table>
): { check: 'refs_resolve'; ok: boolean; detail: string } {
  const hasTableRef = boss.tables.some((table) => table.entries.some((entry) => entry.node.kind === 'tableRef'))
  if (!hasTableRef) {
    return { check: 'refs_resolve', ok: true, detail: 'no tableRef nodes' }
  }
  try {
    compileBoss(boss, resolveSimContext(boss, {}), { tables: sharedTables })
    return {
      check: 'refs_resolve',
      ok: true,
      detail: `resolved against ${sharedTables.size} shared table(s)`,
    }
  } catch (error) {
    if (error instanceof UnresolvedTableRefError || error instanceof CircularTableRefError) {
      return { check: 'refs_resolve', ok: false, detail: error.message }
    }
    throw error
  }
}
