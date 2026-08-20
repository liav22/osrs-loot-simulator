import type { Boss, Node } from '@osrs-loot-simulator/loot-model'

/**
 * The boss's curated uniques and pet, as item keys — see `data/item-flags.json`
 * and `apps/ingest/src/items/item-flags.ts`. A plain `Boss` read: `unique`/`pet`
 * are stored facts set at ingest time, not derived here. Supersedes the
 * rarity-threshold "rarest drops" strip (`docs/DECISIONS.md`'s "'Rarest drops'
 * superseded by curated unique/pet flags").
 */
export function uniqueItemKeys(boss: Boss): Set<string> {
  const keys = new Set<string>()
  const walkNode = (node: Node): void => {
    if (node.kind === 'item' && (node.unique || node.pet)) keys.add(node.itemKey)
    if (node.kind === 'oneOf') for (const entry of node.entries) walkNode(entry.node)
  }
  for (const table of boss.tables) {
    for (const entry of table.entries) walkNode(entry.node)
  }
  return keys
}
