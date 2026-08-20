import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, type Boss, type BossInput } from '@osrs-loot-simulator/loot-model'
import { uniqueItemKeys } from '../src/lib/uniques'

/**
 * `uniqueItemKeys` is a plain read of curated `unique`/`pet` flags off the
 * boss document — no rarity computation, unlike the retired
 * `rarestItemKeys` (`docs/DECISIONS.md`'s "'Rarest drops' superseded by
 * curated unique/pet flags"). Exercised against a synthetic fixture for the
 * flag-reading logic itself, and against the real corpus to confirm the
 * ingest wiring (`data/item-flags.json`) actually reaches the document.
 */
const ROOT = join(__dirname, '..', '..', '..', 'data')

function loadBoss(slug: string): Boss {
  return BossSchema.parse(JSON.parse(readFileSync(join(ROOT, 'bosses', `${slug}.json`), 'utf8')))
}

function makeBoss(tables: BossInput['tables']): Boss {
  return BossSchema.parse({
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    tables,
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
  })
}

describe('uniqueItemKeys', () => {
  it('collects items flagged unique or pet, and nothing else', () => {
    const boss = makeBoss([
      {
        id: 'main',
        mode: 'weighted',
        denominator: 3,
        entries: [
          {
            node: { kind: 'item', itemId: 1, itemKey: 'a-unique', name: 'A unique', qty: { kind: 'exact', n: 1 }, unique: true },
            rate: { kind: 'weight', weight: 1 },
          },
          {
            node: { kind: 'item', itemId: 2, itemKey: 'a-pet', name: 'A pet', qty: { kind: 'exact', n: 1 }, pet: true },
            rate: { kind: 'weight', weight: 1 },
          },
          {
            node: { kind: 'item', itemId: 3, itemKey: 'ordinary', name: 'Ordinary', qty: { kind: 'exact', n: 1 } },
            rate: { kind: 'weight', weight: 1 },
          },
        ],
      },
    ])
    const keys = uniqueItemKeys(boss)
    expect(keys.has('a-unique')).toBe(true)
    expect(keys.has('a-pet')).toBe(true)
    expect(keys.has('ordinary')).toBe(false)
    expect(keys.size).toBe(2)
  })

  it('descends into oneOf', () => {
    const boss = makeBoss([
      {
        id: 'main',
        mode: 'always',
        entries: [
          {
            node: {
              kind: 'oneOf',
              entries: [
                {
                  node: { kind: 'item', itemId: 1, itemKey: 'nested-unique', name: 'Nested unique', qty: { kind: 'exact', n: 1 }, unique: true },
                  rate: { kind: 'weight', weight: 1 },
                },
                {
                  node: { kind: 'item', itemId: 2, itemKey: 'nested-ordinary', name: 'Nested ordinary', qty: { kind: 'exact', n: 1 } },
                  rate: { kind: 'weight', weight: 1 },
                },
              ],
            },
            rate: { kind: 'always' },
          },
        ],
      },
    ])
    const keys = uniqueItemKeys(boss)
    expect(keys.has('nested-unique')).toBe(true)
    expect(keys.has('nested-ordinary')).toBe(false)
  })

  it('is empty for a boss with no curated flags', () => {
    expect(uniqueItemKeys(makeBoss([])).size).toBe(0)
  })
})

describe('uniqueItemKeys against the real corpus', () => {
  it('picks up Zulrah’s uniques and pet', () => {
    const keys = uniqueItemKeys(loadBoss('zulrah'))
    expect(keys.has('tanzanite-fang')).toBe(true)
    expect(keys.has('magic-fang')).toBe(true)
    expect(keys.has('serpentine-visage')).toBe(true)
    expect(keys.has('pet-snakeling')).toBe(true)
    expect(keys.has('coins')).toBe(false)
  })

  it('includes Corporeal Beast’s spirit shield, unlike the old rarity threshold', () => {
    // The whole reason "rarest drops" existed instead of "uniques": a spirit
    // shield is 1/64, too common for any rarity cut to reach. A curated flag
    // has no such blind spot.
    const keys = uniqueItemKeys(loadBoss('corporeal-beast'))
    expect(keys.has('spirit-shield')).toBe(true)
    expect(keys.has('pet-dark-core')).toBe(true)
  })

  it('picks up General Graardor’s pet alongside its Bandos uniques', () => {
    const keys = uniqueItemKeys(loadBoss('general-graardor'))
    expect(keys.has('bandos-hilt')).toBe(true)
    expect(keys.has('pet-general-graardor')).toBe(true)
    expect(keys.has('rune-2h-sword')).toBe(false)
  })
})
