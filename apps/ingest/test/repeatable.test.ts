import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkRepeatableOverridesConsistency,
  deriveRepeatable,
  RepeatableOverridesSchema,
  REPEATABLE_OVERRIDES_PATH,
  type RepeatableOverrides,
} from '../src/inventory/repeatable.js'
import { InventorySchema, type Inventory } from '../src/inventory/schema.js'
import { INVENTORY_PATH } from '../src/inventory/build.js'

const overrides: RepeatableOverrides = RepeatableOverridesSchema.parse({
  repeatableOverridesVersion: 1,
  entries: [
    {
      wikiPage: 'Vorkath',
      repeatable: true,
      reason: 'Players may fight Vorkath again after Dragon Slayer II.',
    },
  ],
})

describe('deriveRepeatable', () => {
  it('defaults to repeatable when the page carries no quest category', () => {
    expect(deriveRepeatable('Zulrah', ['Bosses', 'Snakes'], overrides)).toBe(true)
  })

  it('defaults to non-repeatable when the page is a quest monster', () => {
    expect(deriveRepeatable('Bouncer', ['Bosses', 'Quest monsters'], overrides)).toBe(false)
  })

  it('recognises the Quest NPCs variant too', () => {
    expect(deriveRepeatable('Melzar the Mad', ['Quest NPCs'], overrides)).toBe(false)
  })

  it('is corrected by an override even though the page carries the quest category', () => {
    expect(deriveRepeatable('Vorkath', ['Bosses', 'Quest monsters'], overrides)).toBe(true)
  })

  it('an override for a different title does not leak onto this one', () => {
    expect(deriveRepeatable('Sigmund', ['Bosses', 'Quest monsters'], overrides)).toBe(false)
  })
})

describe('RepeatableOverridesSchema', () => {
  it('rejects a duplicate wikiPage entry', () => {
    const result = RepeatableOverridesSchema.safeParse({
      repeatableOverridesVersion: 1,
      entries: [
        { wikiPage: 'X', repeatable: true, reason: 'a real, substantial reason here' },
        { wikiPage: 'X', repeatable: false, reason: 'a different, substantial reason here' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a reason that is too short to be a real citation', () => {
    const result = RepeatableOverridesSchema.safeParse({
      repeatableOverridesVersion: 1,
      entries: [{ wikiPage: 'X', repeatable: true, reason: 'because' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('checkRepeatableOverridesConsistency', () => {
  const inventory: Pick<Inventory, 'bosses'> = {
    bosses: [
      {
        slug: 'vorkath',
        title: 'Vorkath',
        pageid: 1,
        revid: 1,
        lootSourceId: 'vorkath',
        classification: 'own-table',
        tier: 'C',
        rowCount: 10,
        encounter: null,
        repeatable: true,
      },
    ],
  }

  it('passes when every override names a real boss page', () => {
    expect(checkRepeatableOverridesConsistency(overrides, inventory)).toEqual([])
  })

  it('flags an override naming a page absent from the inventory', () => {
    const typoed = RepeatableOverridesSchema.parse({
      repeatableOverridesVersion: 1,
      entries: [{ wikiPage: 'Vorkathh', repeatable: true, reason: 'a typo in the page name here' }],
    })
    const issues = checkRepeatableOverridesConsistency(typoed, inventory)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.wikiPage).toBe('Vorkathh')
    expect(issues[0]?.message).toMatch(/matches no boss page/)
  })
})

/**
 * The real committed override file against the real generated inventory —
 * skips on a clean checkout the same way `inventory.test.ts`'s real-corpus
 * block does, since `_inventory.json` is a build product.
 */
const present = existsSync(INVENTORY_PATH)

describe.skipIf(!present)('data/repeatable-overrides.json vs the real inventory', () => {
  it('has no orphaned entries', () => {
    const realOverrides = RepeatableOverridesSchema.parse(
      JSON.parse(readFileSync(REPEATABLE_OVERRIDES_PATH, 'utf8'))
    )
    const realInventory: Inventory = InventorySchema.parse(
      JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
    )
    expect(checkRepeatableOverridesConsistency(realOverrides, realInventory)).toEqual([])
  })
})
