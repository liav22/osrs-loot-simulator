import { expect, it } from 'vitest'
import { BossSchema, type Boss, type Condition, type Entry } from '@osrs-loot-simulator/loot-model'

/**
 * The scope-invariant harness — the default shape for testing any validation
 * check whose scope is decided by a field.
 *
 * ## Why this exists
 *
 * Four guards have now been found more permissive than they looked, all in the
 * same way, all caught late:
 *
 *  1. `checkWatchlistConsistency` — `entry.title`, a hand-authored string,
 *     decided which bosses the check expected. Retitling an entry disarmed it.
 *  2. `refs_resolve` — delegated to `compileBoss`, so `SimContext` decided what
 *     it looked at. It reported a clean pass for Lunar Chest with **nothing
 *     resolved**, because every one of its refs sat behind a condition that was
 *     false under the default context.
 *  3. `qty_sane` — looped `entry.node.kind` flatly, so a formula-driven
 *     quantity one level down inside a `oneOf` was never evaluated.
 *  4. `items_known` — the same node-kind blind spot, in the item-collection
 *     walk that feeds it.
 *
 * Each was found by a human noticing, not by a test. The tests that existed all
 * shared a shape: **they mutate the data and never the field that decides the
 * check's scope.** Adding an unresolvable ref, a bad quantity, an unknown item
 * — all data. None of them ever asked "does this check still look here if I
 * move the thing that decides where it looks?"
 *
 * ## The invariant
 *
 * A document that genuinely fails a check must **keep failing** under any
 * mutation that does not repair the defect. A scope hole is precisely the case
 * where the check stops looking, so a real failure silently becomes a pass.
 *
 * That framing is what makes this reusable: the mutations below are
 * verdict-preserving *by construction* — none of them touches the defect, they
 * only change where in the document it lives or what gates it — so any check
 * can be run against all of them without knowing anything about the check.
 *
 * ## Using it
 *
 * ```ts
 * describe('items_known', () => {
 *   expectScopeInvariant({
 *     failing: bossWithAnUnresolvableItem(),
 *     verdict: (boss) => checkItemsKnown(collectItemInputs(boss.tables), index, []).ok,
 *   })
 * })
 * ```
 *
 * Call it inside a `describe`; it registers one `it` per applicable mutation
 * plus a control. A mutation that cannot legally apply to a given document
 * (`apply` returns null — e.g. `oneOf` needs weight rates) is skipped rather
 * than forced, so a check can be covered by whichever subset makes sense for
 * the document shape it operates on.
 *
 * **When a fifth hole turns up, this is where the mutation that finds it
 * belongs** — added once here, and every check that already uses the harness
 * gains the coverage for free.
 */

export interface ScopeMutation {
  name: string
  /** What this mutation is testing for, shown when it fails. */
  because: string
  /** Returns null when the mutation cannot legally apply to this document. */
  apply: (boss: Boss) => Boss | null
}

/** Re-parse so an illegal mutation fails loudly here rather than silently downstream. */
function reparse(boss: unknown): Boss | null {
  const parsed = BossSchema.safeParse(boss)
  return parsed.success ? parsed.data : null
}

function mapEntries(boss: Boss, f: (entry: Entry) => Entry): Boss {
  return {
    ...boss,
    tables: boss.tables.map((table) => ({ ...table, entries: table.entries.map(f) })),
  }
}

/**
 * Conditions that are false under `resolveSimContext(boss, {})`. A check that
 * resolves its scope through a compile step drops these entries before looking
 * at them — which is exactly how `refs_resolve` came to pass on nothing.
 */
const FALSE_BY_DEFAULT: readonly Condition[] = [
  { kind: 'members', value: true },
  { kind: 'includes', field: 'moonsKilled', values: ['blood'] },
  { kind: 'levelAtLeast', field: 'delveLevel', n: 9 },
  { kind: 'levelAtLeast', field: 'fishingLevel', n: 40, atMost: 45 },
  { kind: 'questComplete', quest: 'Some Quest' },
  { kind: 'variant', name: 'nonexistent' },
]

export const SCOPE_MUTATIONS: readonly ScopeMutation[] = [
  ...FALSE_BY_DEFAULT.map((condition) => ({
    name: `behind a false ${condition.kind} condition`,
    because:
      'whether an entry is reachable in one particular run is a different question from ' +
      'whether the document is well-formed; only the second is a validation check\'s business',
    apply: (boss: Boss) =>
      reparse(
        mapEntries(boss, (entry) => ({
          ...entry,
          conditions: [...(entry.conditions ?? []), condition],
        }))
      ),
  })),
  {
    name: 'wrapped one level down inside a oneOf',
    because:
      'LeafNodeSchema admits item and tableRef nodes, so a defect can legally sit one level ' +
      'down; a flat loop over entry.node.kind cannot see it',
    apply: (boss: Boss) =>
      reparse({
        ...boss,
        tables: boss.tables.map((table) => ({
          ...table,
          // `oneOf` entries must carry weight rates and the wrapper needs one
          // too, so this only applies to weighted tables — `reparse` returns
          // null for the rest and the harness skips it.
          entries: table.entries.map((entry) => ({
            ...entry,
            node:
              entry.node.kind === 'oneOf'
                ? entry.node
                : { kind: 'oneOf', entries: [{ node: entry.node, rate: { kind: 'weight', weight: 1 } }] },
          })),
        })),
      }),
  },
  {
    name: 'preceded by an unrelated clean table',
    because: 'a check must not stop at the first table, or be satisfied by a clean one',
    apply: (boss: Boss) =>
      reparse({
        ...boss,
        tables: [
          {
            id: 'scope-mutation-clean-table',
            mode: 'always',
            entries: [
              {
                node: {
                  kind: 'item',
                  itemId: 995,
                  itemKey: 'coins',
                  name: 'Coins',
                  qty: { kind: 'exact', n: 1 },
                },
                rate: { kind: 'always' },
              },
            ],
          },
          ...boss.tables,
        ],
      }),
  },
  {
    name: 'renamed (slug, name, wikiPage)',
    because:
      'identity fields must not decide what a check inspects — this is the entry.title ' +
      'gap generalised, where a hand-authored string chose the check\'s own expectations',
    apply: (boss: Boss) =>
      reparse({ ...boss, slug: 'renamed-source', name: 'Renamed Source', wikiPage: 'Renamed Source' }),
  },
]

export interface ScopeInvariantSpec {
  /** A document that genuinely fails the check. */
  failing: Boss
  /** True when the check PASSES for this document. */
  verdict: (boss: Boss) => boolean
  /** Mutations to skip, by name, with a stated reason. */
  skip?: Readonly<Record<string, string>>
}

export function expectScopeInvariant(spec: ScopeInvariantSpec): void {
  it('control: the unmutated document fails the check', () => {
    // Without this the whole suite could pass vacuously against a document
    // that never failed in the first place.
    expect(spec.verdict(spec.failing)).toBe(false)
  })

  for (const mutation of SCOPE_MUTATIONS) {
    const skipReason = spec.skip?.[mutation.name]
    if (skipReason !== undefined) {
      it.skip(`still fails ${mutation.name} (skipped: ${skipReason})`, () => {})
      continue
    }

    const mutated = mutation.apply(spec.failing)
    if (mutated === null) {
      // Not applicable to this document's shape — recorded as a skip rather
      // than silently dropped, so the coverage a check actually has is visible.
      it.skip(`still fails ${mutation.name} (not applicable to this document)`, () => {})
      continue
    }

    it(`still fails ${mutation.name}`, () => {
      expect(spec.verdict(mutated), mutation.because).toBe(false)
    })
  }
}
