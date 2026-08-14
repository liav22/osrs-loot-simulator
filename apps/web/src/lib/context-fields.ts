import {
  DERIVED_CONTEXT_FIELDS,
  FORMULA_CONTEXT_FIELDS,
  type Boss,
  type Entry,
  type Node,
  type SimContextField,
  type Table,
} from '@osrs-loot-simulator/loot-model'

/**
 * Which `SimContext` fields a given boss actually responds to.
 *
 * Rendering all sixteen fields on every boss would bury the two that matter
 * behind fourteen that do nothing; rendering none is how Doom of Mokhaiotl
 * shipped without a `delveLevel` control and Lunar Chest without
 * `moonsKilled`. So the control set is derived from the document, the same way
 * the existing quest toggles are built from the boss's own `questComplete`
 * conditions rather than a free-text field.
 *
 * Two sources, because one is not enough:
 *
 * 1. **Conditions** — `levelAtLeast` (including its `killCount` field, which
 *    absorbed the retired `killCountAtLeast` kind) and `includes` name their
 *    field directly.
 * 2. **Formula references** — a formula's context reads are invisible in the
 *    document. Zalcano's `isMVP` appears in no condition anywhere; it is read
 *    only inside `zalcano_mvp_share`/`zalcano_mvp_only`. That is what
 *    `FORMULA_CONTEXT_FIELDS` exists to declare, and why this walks every
 *    place a formula can be referenced (rates, quantities, roll counts and
 *    both `qtyMultiplier` sites) rather than just rates.
 *
 * Derived fields are replaced by the inputs they are computed from: offering a
 * `totalDamage` control would be offering a control that does nothing, since
 * `withDerivedContext` overwrites it. The user moves `hitpointsDamage` and
 * `shieldDamage`, and `totalDamage` follows.
 */
export interface BossContextSurface {
  fields: ReadonlySet<SimContextField>
  /** Item keys some entry gates on owning, for the `ownedCounts` controls. */
  ownershipItemKeys: readonly string[]
}

function addFormulaFields(id: string, into: Set<SimContextField>): void {
  const declared = FORMULA_CONTEXT_FIELDS[id as keyof typeof FORMULA_CONTEXT_FIELDS]
  for (const field of declared ?? []) into.add(field)
}

/** Any `{ kind: 'formula', id }`-shaped value, wherever it can appear. */
function collectFormula(value: unknown, into: Set<SimContextField>): void {
  if (value === null || typeof value !== 'object') return
  const maybe = value as { kind?: unknown; id?: unknown }
  if (maybe.kind === 'formula' && typeof maybe.id === 'string') addFormulaFields(maybe.id, into)
}

interface Walk {
  into: Set<SimContextField>
  ownedKeys: string[]
  shared: ReadonlyMap<string, Table>
  seen: Set<string>
}

function walkNode(node: Node, walk: Walk): void {
  if (node.kind === 'item') {
    collectFormula(node.qty, walk.into)
    return
  }
  if (node.kind === 'tableRef') {
    collectFormula(node.qtyMultiplier, walk.into)
    // Follow the reference. Lunar Chest's per-set duplicate protection is the
    // reason this is not optional: its `ownershipGate`s live entirely in the
    // three `lunar_chest_*_set` shared tables, so a boss-document-only walk
    // finds no ownership controls for the one source that most needs them.
    // Cycle-guarded, mirroring `compile.ts`'s own tableRef resolution.
    if (walk.seen.has(node.ref)) return
    walk.seen.add(node.ref)
    const target = walk.shared.get(node.ref)
    if (target !== undefined) walkTable(target, walk)
    return
  }
  if (node.kind === 'oneOf') {
    for (const entry of node.entries) walkEntry(entry, walk)
  }
}

function walkEntry(entry: Entry, walk: Walk): void {
  const into = walk.into
  for (const condition of entry.conditions ?? []) {
    switch (condition.kind) {
      case 'members':
      case 'ringOfWealth':
      case 'onSlayerTask':
      case 'variant':
        into.add(condition.kind === 'variant' ? 'variant' : condition.kind)
        break
      case 'questComplete':
        into.add('questsComplete')
        break
      case 'levelAtLeast':
        into.add(condition.field)
        break
      case 'includes':
        into.add(condition.field)
        break
    }
  }
  if (entry.ownershipGate !== undefined) {
    into.add('ownedCounts')
    walk.ownedKeys.push(entry.ownershipGate.itemKey)
  }
  collectFormula(entry.rate, into)
  walkNode(entry.node, walk)
}

function walkTable(table: Table, walk: Walk): void {
  collectFormula(table.rolls, walk.into)
  collectFormula(table.qtyMultiplier, walk.into)
  for (const entry of table.entries) walkEntry(entry, walk)
}

export function contextSurfaceOf(
  boss: Boss,
  sharedTables: ReadonlyMap<string, Table> = new Map()
): BossContextSurface {
  const found = new Set<SimContextField>()
  const ownedKeys: string[] = []
  const walk: Walk = { into: found, ownedKeys, shared: sharedTables, seen: new Set() }
  for (const table of boss.tables) walkTable(table, walk)

  // A boss whose `contextDefaults` pin a field is declaring that field
  // relevant even when nothing in its tables reads it structurally.
  for (const key of Object.keys(boss.contextDefaults)) found.add(key as SimContextField)

  // Replace derived fields with their inputs — see the doc comment.
  const fields = new Set<SimContextField>()
  for (const field of found) {
    const inputs = DERIVED_CONTEXT_FIELDS[field as keyof typeof DERIVED_CONTEXT_FIELDS]
    if (inputs === undefined) fields.add(field)
    else for (const input of inputs) fields.add(input)
  }

  return { fields, ownershipItemKeys: [...new Set(ownedKeys)].sort() }
}
