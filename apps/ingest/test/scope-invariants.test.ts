import { describe } from 'vitest'
import { BossSchema, type Boss, type BossInput } from '@osrs-loot-simulator/loot-model'
import { expectScopeInvariant } from './helpers/scope-invariant.js'
import { checkRefsResolve } from '../src/validate/refs-resolve.js'
import { checkQtySane } from '../src/validate/qty-sane.js'
import { checkRatesValid } from '../src/validate/rates-valid.js'
import { checkWeightsSum } from '../src/validate/weights-sum.js'
import { checkItemsKnown } from '../src/validate/items-known.js'
import { checkDropsCoveredAgainst } from '../src/validate/drops-covered.js'
import { collectItemInputs } from '../src/parse/collect-items.js'
import type { ItemIndex } from '../src/items/index.js'
import type { ItemAllowlist } from '../src/items/allowlist.js'

/**
 * One scope-invariant suite per validation check whose scope is decided by a
 * field. See `helpers/scope-invariant.ts` for what the invariant is and why
 * four separate guards needed it before it existed.
 *
 * Each suite hands the harness a document that genuinely fails its check, and
 * asserts the verdict survives every mutation that does not repair the defect.
 * Adding a new check here should be three lines; adding a new mutation is one
 * entry in `SCOPE_MUTATIONS` and every suite below gains it at once.
 */

function boss(tables: BossInput['tables']): Boss {
  return BossSchema.parse({
    slug: 'scope-test',
    name: 'Scope Test',
    wikiPage: 'Scope Test',
    wikiRevId: 1,
    tables,
    status: 'needs_review',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: false, checks: [] },
  })
}

/** A weighted table, so the `oneOf` mutation is legal against these documents. */
function weightedTable(entries: BossInput['tables'][number]['entries'], denominator = 4) {
  return { id: 'main', mode: 'weighted' as const, denominator, entries }
}

// `indexByItemKey` slugifies `itemName`, so 'Known Thing' -> 'known-thing'.
const ITEM_INDEX: ItemIndex = {
  itemIndexVersion: 2,
  generatedAt: '2026-01-01T00:00:00.000Z',
  rowCount: 1,
  entries: [{ itemName: 'Known Thing', itemId: 1, rawIds: ['1'], source: 'infobox_item' }],
}

const EMPTY_ALLOWLIST: ItemAllowlist = { allowlistVersion: 1, entries: [] }

describe('refs_resolve is scope-invariant', () => {
  // Defect: a tableRef pointing at a record that does not exist.
  expectScopeInvariant({
    failing: boss([
      weightedTable([
        { node: { kind: 'tableRef', ref: 'no_such_table' }, rate: { kind: 'weight', weight: 4 } },
      ]),
    ]),
    verdict: (b) => checkRefsResolve(b, new Map()).ok,
  })
})

describe('qty_sane is scope-invariant', () => {
  // Defect: a formula-driven quantity whose formula is still a stub, so
  // evaluating it throws. `zalcano_points` is deliberately unimplemented.
  expectScopeInvariant({
    failing: boss([
      weightedTable([
        {
          node: {
            kind: 'item',
            itemId: 1,
            itemKey: 'known-thing',
            name: 'Known Thing',
            qty: { kind: 'formula', id: 'zalcano_points', params: {} },
          },
          rate: { kind: 'weight', weight: 4 },
        },
      ]),
    ]),
    verdict: (b) => checkQtySane(b).ok,
  })
})

describe('items_known is scope-invariant', () => {
  // Defect: an item that is in neither the item index nor the allowlist.
  expectScopeInvariant({
    failing: boss([
      weightedTable([
        {
          node: {
            kind: 'item',
            itemId: 4242,
            itemKey: 'not-in-the-index',
            name: 'Not In The Index',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 4 },
        },
      ]),
    ]),
    verdict: (b) => checkItemsKnown(collectItemInputs(b.tables), ITEM_INDEX, EMPTY_ALLOWLIST).ok,
  })
})

describe('rates_valid is scope-invariant', () => {
  // Defect: a formula RATE whose formula is a stub. `independent` mode, since
  // that is the only mode admitting formula rates.
  expectScopeInvariant({
    failing: boss([
      {
        id: 'main',
        mode: 'independent',
        entries: [
          {
            node: {
              kind: 'item',
              itemId: 1,
              itemKey: 'known-thing',
              name: 'Known Thing',
              qty: { kind: 'exact', n: 1 },
            },
            rate: { kind: 'formula', id: 'zalcano_points', params: {} },
          },
        ],
      },
    ]),
    verdict: (b) => checkRatesValid(b).ok,
    skip: {
      'wrapped one level down inside a oneOf':
        "NodeSchema pins oneOf entries to weight rates, so a formula rate cannot legally " +
        'sit inside one — the hole this mutation looks for is closed by the schema, not by the check',
    },
  })
})

describe('weights_sum is scope-invariant', () => {
  // Defect: weights overflowing the denominator (a shortfall is legal per 4.3,
  // an overflow is not).
  expectScopeInvariant({
    failing: boss([
      weightedTable(
        [
          {
            node: {
              kind: 'item',
              itemId: 1,
              itemKey: 'known-thing',
              name: 'Known Thing',
              qty: { kind: 'exact', n: 1 },
            },
            rate: { kind: 'weight', weight: 9 },
          },
        ],
        4
      ),
    ]),
    verdict: (b) => checkWeightsSum(b.tables).ok,
    skip: {
      'wrapped one level down inside a oneOf':
        'wrapping changes the weight arithmetic itself (the wrapper carries its own weight), ' +
        'so this mutation is not verdict-preserving for a check about weights',
    },
  })
})

describe('drops_covered is scope-invariant', () => {
  // Defect: the wiki lists a drop the document does not carry.
  //
  // Covered by the harness like the other five, which is only possible because
  // the verdict was split out of the snapshot read
  // (`checkDropsCoveredAgainst`). Worth stating plainly: this check exists
  // BECAUSE the harness structurally could not have found the transclusion hole
  // — its invariant is about a failing document continuing to fail, and it has
  // no notion of a document that should have been larger. Being scope-invariant
  // is still necessary; it was never sufficient.
  expectScopeInvariant({
    failing: boss([
      weightedTable([
        {
          node: {
            kind: 'item',
            itemId: 1,
            itemKey: 'known-thing',
            name: 'Known Thing',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 4 },
        },
      ]),
    ]),
    // 'Missing Thing' is in the wiki's rows and in no mutation of the document,
    // so every mutation must keep failing.
    verdict: (b) =>
      checkDropsCoveredAgainst(['Known Thing', 'Missing Thing'], b.tables, new Map()).ok,
  })
})
