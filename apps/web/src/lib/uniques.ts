import type { Boss, Node, Table } from '@osrs-loot-simulator/loot-model'

/**
 * The boss's curated uniques and pet, as item keys — see `data/item-flags.json`
 * and `apps/ingest/src/items/item-flags.ts`. Reads the boss and reachable shared
 * tables: `unique`/`pet`
 * are stored facts set at ingest time, not derived here. Supersedes the
 * rarity-threshold "rarest drops" strip (`docs/DECISIONS.md`'s "'Rarest drops'
 * superseded by curated unique/pet flags").
 */
export function uniqueItemKeys(boss: Boss, sharedTables?: ReadonlyMap<string, Table>): Set<string> {
  const keys = new Set<string>()
  const visited = new Set<string>()
  const walkNode = (node: Node): void => {
    if (node.kind === 'item' && (node.unique || node.pet)) keys.add(node.itemKey)
    if (node.kind === 'oneOf') for (const entry of node.entries) walkNode(entry.node)
    if (node.kind === 'tableRef' && !visited.has(node.ref)) {
      visited.add(node.ref)
      const table = sharedTables?.get(node.ref)
      if (table) for (const entry of table.entries) walkNode(entry.node)
    }
  }
  for (const table of boss.tables) {
    for (const entry of table.entries) walkNode(entry.node)
  }
  return keys
}
