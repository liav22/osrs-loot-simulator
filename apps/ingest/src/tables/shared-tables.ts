import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SharedTableSchema, type Table } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../snapshots/store.js'

/** Phase 3's hand-authored `data/tables/*.json` records (PROJECT_PLAN.md 5). */
export const SHARED_TABLE_IDS = ['rare_drop_table', 'gem_drop_table', 'mega_rare_drop_table'] as const

export const TABLES_DIR = join(REPO_ROOT, 'data', 'tables')

export async function loadSharedTables(): Promise<Map<string, Table>> {
  const shared = new Map<string, Table>()
  for (const id of SHARED_TABLE_IDS) {
    const raw = JSON.parse(await readFile(join(TABLES_DIR, `${id}.json`), 'utf8'))
    shared.set(id, SharedTableSchema.parse(raw))
  }
  return shared
}
