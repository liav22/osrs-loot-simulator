import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, resolveSimContext } from '@osrs-loot-simulator/loot-model'
import { BOSSES_DIR } from '../src/parse/parse-boss.js'
import { snapshotPath, readSnapshot, slugify } from '../src/snapshots/store.js'
import { BucketResponseSchema } from '../src/wiki/schemas.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'

/**
 * Black Knight Titan's and Obor's `===Seeds===` heading is
 * `{{GeneralSeedDropLines|<accessRate>|<combat level>}}`, whose template page
 * is a bare `{{#invoke:GeneralSeedDropLines|main}}` — pure Lua, no wikitext
 * `expand-transclusions.ts` could ever run (see the two overrides' own
 * `note`s and docs/DECISIONS.md's "GeneralSeedDropLines" entry). This pins
 * the reimplementation of `Module:GeneralSeedDropLines`'s actual logic
 * (fetched once, a legitimate research fetch under CLAUDE.md's "never
 * re-hit the wiki to fix a parser bug" — this recovers a genuinely new
 * source, not a re-parse) against the wiki's own rendered figures.
 */
const SNAPSHOTS_PRESENT = existsSync(snapshotPath('dropsline', 'obor'))

async function bucketRarities(title: string): Promise<Map<string, number>> {
  const snapshot = await readSnapshot('dropsline', slugify(title))
  const rows = BucketResponseSchema.parse(snapshot.body).bucket ?? []
  const out = new Map<string, number>()
  for (const row of rows) {
    const name = row.item_name
    const json = row.drop_json
    if (typeof name !== 'string' || typeof json !== 'string') continue
    const parsed = JSON.parse(json) as { Rarity?: string }
    const match = /^~?\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*$/.exec(parsed.Rarity ?? '')
    if (match === null) continue
    out.set(name, Number(match[1]!.replace(/,/g, '')) / Number(match[2]!.replace(/,/g, '')))
  }
  return out
}

const SEED_NAMES = [
  'Potato seed',
  'Onion seed',
  'Cabbage seed',
  'Tomato seed',
  'Sweetcorn seed',
  'Strawberry seed',
  'Watermelon seed',
  'Snape grass seed',
  'Barley seed',
  'Hammerstone seed',
  'Asgarnian seed',
  'Jute seed',
  'Yanillian seed',
  'Krandorian seed',
  'Wildblood seed',
  'Marigold seed',
  'Nasturtium seed',
  'Rosemary seed',
  'Woad seed',
  'Limpwurt seed',
  'Redberry seed',
  'Cadavaberry seed',
  'Dwellberry seed',
  'Jangerberry seed',
  'Whiteberry seed',
  'Poison ivy seed',
  'Guam seed',
  'Marrentill seed',
  'Tarromin seed',
  'Harralander seed',
  'Ranarr seed',
  'Toadflax seed',
  'Irit seed',
  'Avantoe seed',
  'Kwuarm seed',
  'Snapdragon seed',
  'Cadantine seed',
  'Lantadyme seed',
  'Dwarf weed seed',
  'Torstol seed',
  'Mushroom spore',
  'Belladonna seed',
  'Cactus seed',
  'Potato cactus seed',
]

describe.skipIf(!SNAPSHOTS_PRESENT)('GeneralSeedDropLines reimplementation', () => {
  it.each([
    ['black-knight-titan', 'Black Knight Titan', 18 / 128],
    ['obor', 'Obor', 18 / 135],
  ])('%s: all 44 seed names present, and the oneOf reconstructs the %s access rate exactly', async (slug, title, accessRate) => {
    const shared = await loadSharedTables()
    const boss = BossSchema.parse(JSON.parse(await readFile(join(BOSSES_DIR, `${slug}.json`), 'utf8')))
    const seeds = boss.tables.find((t) => t.id === `${slug}:seeds`)
    expect(seeds).toBeDefined()
    const oneOf = seeds!.entries[0]!.node
    expect(oneOf.kind).toBe('oneOf')
    if (oneOf.kind !== 'oneOf') throw new Error('unreachable')
    expect(oneOf.entries).toHaveLength(44)

    const names = oneOf.entries.map((e) => (e.node.kind === 'item' ? e.node.name : '')).sort()
    expect(names).toEqual([...SEED_NAMES].sort())

    // Each entry's own weight is the RAW (pre-floor) per-seed probability —
    // not the wiki's own floor()'d 1/N display figure — because summing the
    // floored figures independently overshoots the declared access rate by
    // 0.3%-0.7% depending on how the roundings land (measured: 0.29% for
    // Black Knight Titan, 0.74% for Obor), enough to fail
    // marginal-rates.test.ts's 0.5% tolerance on Obor specifically. The raw
    // values are an EXACT partition by construction (see docs/DECISIONS.md):
    // the per-bracket item shares sum to that bracket's own denominator and
    // the per-bracket combat-range shares sum to 1 across every contributing
    // bracket, so summing them reproduces the access rate to float
    // precision, matching every other oneOf-at-access-rate shape in the
    // corpus (abyssal-sire's seed/talisman tables, etc.).
    const sum = oneOf.entries.reduce(
      (total, e) => total + (e.rate.kind === 'weight' && typeof e.rate.weight === 'number' ? e.rate.weight : 0),
      0
    )
    expect(sum).toBeCloseTo(accessRate, 10)

    const bucket = await bucketRarities(title)
    const ctx = resolveSimContext(boss, {})
    const ev = expectedValue(boss, ctx, { tables: shared })
    let checked = 0
    for (const drop of ev.items) {
      const stated = bucket.get(drop.name)
      if (stated === undefined || !SEED_NAMES.includes(drop.name)) continue
      checked++
      // The wiki's own floor()'d display rate differs from the true raw
      // rate by up to ~2% on the largest-share seeds (Potato seed: true
      // 1/44.90 displays as 1/44, a real ~2% gap from floor() alone, not a
      // reimplementation error — reproduced exactly against Black Knight
      // Titan's own displayed figures below, whose floor() roundings happen
      // to land closer to the true rate). 5% covers the worst observed case
      // with room; this is deliberately looser than marginal-rates.test.ts's
      // general 0.5%, which is exactly why these two sources are excluded
      // there (AUTHORED map) and pinned here instead.
      expect(
        Math.abs(drop.expectedDrops - stated) / stated,
        `${drop.name}: composed ${drop.expectedDrops}, wiki-displayed ${stated}`
      ).toBeLessThan(0.05)
    }
    expect(checked).toBeGreaterThan(30)
  })

  it("Black Knight Titan's own displayed figures match floor(1/rawRate) exactly, confirming the reimplementation (not just the item list)", async () => {
    const shared = await loadSharedTables()
    const boss = BossSchema.parse(
      JSON.parse(await readFile(join(BOSSES_DIR, 'black-knight-titan.json'), 'utf8'))
    )
    const bucket = await bucketRarities('Black Knight Titan')
    const ctx = resolveSimContext(boss, {})
    const ev = expectedValue(boss, ctx, { tables: shared })

    // Spot-checked directly against the module's own logic (see the
    // override's note): a seed spanning only the lowest bracket (Potato
    // seed), one spanning to the middle (Wildblood seed), and one reaching
    // the final partial bracket (Torstol seed, Mushroom spore) — the three
    // structurally distinct cases `groupSeeds`' loop can produce.
    const spotChecks: Record<string, number> = {
      'Potato seed': 1 / 48,
      'Wildblood seed': 1 / 1210,
      'Torstol seed': 1 / 88888,
      'Mushroom spore': 1 / 91,
    }
    for (const [name, expected] of Object.entries(spotChecks)) {
      const stated = bucket.get(name)
      expect(stated, name).toBeCloseTo(expected, 6)
      const drop = ev.items.find((d) => d.name === name)
      expect(drop, name).toBeDefined()
      // floor(1/raw) reconstructed from the composed (raw) rate must match
      // the wiki's own displayed denominator exactly.
      expect(Math.floor(1 / drop!.expectedDrops), name).toBe(Math.round(1 / expected))
    }
  })
})
