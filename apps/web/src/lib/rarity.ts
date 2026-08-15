import type { Boss, ExpectedValueResult, Node, Table } from '@osrs-loot-simulator/loot-model'

/**
 * Which drops get the highlight treatment and the strip above the results grid.
 *
 * ## Why this is "rarest", not "uniques"
 *
 * The rework asked for a rarity threshold separating the drops a player would
 * call unique from ordinary rares, checked against known bosses before any
 * number was hardcoded. It was checked, using `expectedValue` against the real
 * committed documents, and **no threshold separates them.** The number below is
 * therefore not a unique detector wearing a threshold's clothes — the concept
 * was changed to match what the signal actually measures.
 *
 * Raw rarity fails outright. On five of six bosses the rarest drop is junk:
 *
 *   - Zulrah — `Rune javelin` at 1/10,199 and `Chaos talisman` at 1/6,799 are
 *     both rarer than `Tanzanite fang`, `Magic fang` and `Serpentine visage`
 *     (1/1,024 each). No cut point admits a fang and excludes a javelin.
 *   - Sarachnis, Kraken — identical shape, same offenders.
 *   - Corporeal Beast fails in the *other* direction: `Spirit shield` is
 *     1/64 and `Holy elixir` 1/171, commoner than dozens of ordinary drops.
 *   - Only Vorkath separates cleanly (uniques at 1/1,000 and rarer, next
 *     non-unique at 1/546).
 *
 * The cause is the shared rare/mega-rare/gem drop tables: every source with
 * RDT access carries the same junk at 1/4,000–1/13,000. Excluding items only
 * reachable through a `tableRef` removes that entire class and is derivable
 * here, at render time, with no schema change — which is what `ownItemKeys`
 * does. That leaves 1/300 as the best available cut, and it is still not
 * clean: it admits `Long bone` (1/400) and `Curved bone` (1/5,013) on General
 * Graardor, `Uncut onyx` on Zulrah, and misses Corp's spirit shield entirely.
 *
 * Called "rarest drops" in the UI, those stop being errors. Curved bone
 * genuinely is one of Graardor's rarest drops. A spirit shield genuinely is
 * not rare on Corp — and it still leads the grid, because the grid sorts by
 * value and a spirit shield is worth more than everything around it. The
 * strip's job is the payoff a player would otherwise have to hunt for; the
 * honest label is the one that doesn't overclaim.
 */
export const RAREST_THRESHOLD = 300

/**
 * Item keys reachable in the boss's own tables without crossing a `tableRef`.
 *
 * Descends `oneOf` (an item inside one is still this boss's own drop) and
 * stops dead at `tableRef` — a shared table's contents belong to that record,
 * and following the ref is precisely what drags the rare drop table's junk
 * into the answer.
 */
export function ownItemKeys(boss: Boss, tables: readonly Table[] = boss.tables): Set<string> {
  const keys = new Set<string>()
  const walkNode = (node: Node): void => {
    switch (node.kind) {
      case 'item':
        keys.add(node.itemKey)
        return
      case 'oneOf':
        for (const entry of node.entries) walkNode(entry.node)
        return
      case 'tableRef':
      case 'nothing':
        return
    }
  }
  for (const table of tables) {
    for (const entry of table.entries) walkNode(entry.node)
  }
  return keys
}

/**
 * The rarest of a boss's own drops, as item keys.
 *
 * Rarity comes from the analytic `expectedValue`, not from the simulated run:
 * a drop's rarity is a property of the table, and reading it off a sample
 * would make the highlight flicker between seeds. `expected` is undefined when
 * EV cannot be computed for a source (`withoutReplacement` past its supported
 * roll count, an unimplemented formula) — in that case nothing is highlighted,
 * which is the right failure: no strip at all beats a wrong one.
 */
export function rarestItemKeys(
  boss: Boss,
  expected: ExpectedValueResult | undefined,
  threshold = RAREST_THRESHOLD
): Set<string> {
  if (expected === undefined) return new Set()
  const own = ownItemKeys(boss)
  const rarest = new Set<string>()
  for (const item of expected.items) {
    if (!own.has(item.itemKey)) continue
    if (item.expectedDrops <= 0) continue
    if (1 / item.expectedDrops >= threshold) rarest.add(item.itemKey)
  }
  return rarest
}
