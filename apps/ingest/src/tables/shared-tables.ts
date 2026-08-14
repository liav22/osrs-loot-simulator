import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SharedTableSchema, type Table } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../snapshots/store.js'

/**
 * Hand-authored `data/tables/*.json` records (PROJECT_PLAN.md 5): tables
 * referenced by `tableRef` rather than inlined into a boss, so one correction
 * fixes every source that reaches them.
 *
 * The three Phase 3 records (`rare_drop_table`, `gem_drop_table`,
 * `mega_rare_drop_table`) are genuinely shared across ~17 tier-C sources. Later
 * additions need not be: Lunar Chest's three per-Moon set tables have exactly
 * one referencing source each, and live here because a `tableRef` target has
 * to — `oneOf` cannot carry the `ownershipGate`s their duplicate protection
 * needs. "Referenced by id" is what this directory means, not "used twice".
 */
export const TABLES_DIR = join(REPO_ROOT, 'data', 'tables')

export class SharedTableIdMismatchError extends Error {
  constructor(file: string, declaredId: string) {
    super(
      `data/tables/${file} declares id '${declaredId}'; the file name and the id must match, ` +
        'since tableRef resolves by id and the file name is what a human greps for'
    )
    this.name = 'SharedTableIdMismatchError'
  }
}

/**
 * Loaded by scanning the directory rather than from a hardcoded id list. The
 * list version silently ignored any new record until someone remembered to add
 * it, which fails in the worst direction: `refs_resolve` reports an
 * unresolvable ref and the real cause (a file present but unregistered) is
 * invisible. Scanning plus the id/filename check above cannot drift.
 */
export async function loadSharedTables(): Promise<Map<string, Table>> {
  const shared = new Map<string, Table>()
  const files = (await readdir(TABLES_DIR)).filter((f) => f.endsWith('.json')).sort()
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(TABLES_DIR, file), 'utf8'))
    const table = SharedTableSchema.parse(raw)
    const expected = file.slice(0, -'.json'.length)
    if (table.id !== expected) throw new SharedTableIdMismatchError(file, table.id)
    shared.set(table.id, table)
  }
  return shared
}
