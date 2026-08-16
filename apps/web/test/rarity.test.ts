import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  SharedTableSchema,
  expectedValue,
  resolveSimContext,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { RAREST_THRESHOLD, ownItemKeys, rarestItemKeys } from '../src/lib/rarity'

/**
 * Against the real committed documents, not fixtures. The whole reason this
 * module exists in its current shape is a measurement over the real corpus —
 * a fixture would let a future threshold change pass without ever meeting the
 * data that decided the current one.
 */
const ROOT = join(__dirname, '..', '..', '..', 'data')

function loadBoss(slug: string): Boss {
  return BossSchema.parse(JSON.parse(readFileSync(join(ROOT, 'bosses', `${slug}.json`), 'utf8')))
}

const shared: Map<string, Table> = new Map(
  readdirSync(join(ROOT, 'tables'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const table = SharedTableSchema.parse(JSON.parse(readFileSync(join(ROOT, 'tables', f), 'utf8')))
      return [table.id, table] as const
    })
)

function rarestFor(slug: string): Set<string> {
  const boss = loadBoss(slug)
  // `resolveSimContext`, not the bare package `DEFAULT_SIM_CONTEXT`: a source
  // whose only variant is quest-gated (Vorkath's "Post-quest") sets its own
  // `contextDefaults.variant` so the DEFAULT view is not empty — see
  // `docs/DECISIONS.md`'s "dropversion= parser fix" entry. Bypassing that
  // (as this helper used to) reads every variant-gated entry as filtered out,
  // which used to be invisible only because no regular drop row carried a
  // variant condition before that fix landed.
  return rarestItemKeys(boss, expectedValue(boss, resolveSimContext(boss), { tables: shared }))
}

describe('ownItemKeys', () => {
  it('stops at a tableRef instead of following it', () => {
    // Zulrah reaches the rare and mega-rare drop tables. `Rune javelin` is in
    // the mega-rare table at 1/10,199 — rarer than every genuine Zulrah unique
    // — and pulling it in is exactly what makes a bare rarity threshold
    // unusable. It must not be one of Zulrah's own keys.
    const own = ownItemKeys(loadBoss('zulrah'))
    expect(own.has('tanzanite-fang')).toBe(true)
    expect([...own].some((key) => key.includes('rune-javelin'))).toBe(false)
  })

  it('descends oneOf, which is still the boss own drop', () => {
    // Reward pool's Fishing brackets each carry a `oneOf` of that bracket's
    // fish; a flat scan over entry nodes would collect none of them.
    const own = ownItemKeys(loadBoss('reward-pool'))
    expect(own.size).toBeGreaterThan(0)
  })
})

describe('rarestItemKeys against the real corpus', () => {
  it('picks up Vorkath visages and leaves the ordinary rares alone', () => {
    const rarest = rarestFor('vorkath')
    expect(rarest.has('draconic-visage')).toBe(true) // 1/5,000
    expect(rarest.has('skeletal-visage')).toBe(true) // 1/5,000
    expect(rarest.has('dragonbone-necklace')).toBe(true) // 1/1,000
    expect(rarest.has('dragon-longsword')).toBe(false) // 1/75
    expect(rarest.has('blue-dragonhide')).toBe(false) // every kill
  })

  it('picks up the Zulrah uniques without the mega-rare table junk', () => {
    // The measurement that changed the design: with shared tables followed,
    // no threshold admits a fang (1/1,024) and excludes a rune javelin
    // (1/10,199). Excluding tableRef contents is what makes this pass.
    const rarest = rarestFor('zulrah')
    expect(rarest.has('tanzanite-fang')).toBe(true)
    expect(rarest.has('magic-fang')).toBe(true)
    expect(rarest.has('serpentine-visage')).toBe(true)
    expect(rarest.has('magma-mutagen')).toBe(true)
    for (const key of rarest) expect(key).not.toContain('javelin')
  })

  it('excludes Corporeal Beast spirit shield, and says so out loud', () => {
    // Not an oversight — a spirit shield is 1/64, commoner than dozens of
    // ordinary Corp drops, so no threshold reaches it without dragging those
    // along. This is why the strip is labelled "rarest drops" rather than
    // "uniques". Value sorting still puts the shield at the top of the grid.
    const rarest = rarestFor('corporeal-beast')
    expect(rarest.has('spirit-shield')).toBe(false)
    expect(rarest.has('jar-of-spirits')).toBe(true) // 1/1,000
  })

  it('is empty when expected value could not be computed', () => {
    expect(rarestItemKeys(loadBoss('vorkath'), undefined).size).toBe(0)
  })

  it('never marks a drop that is not actually rare, on any source', () => {
    // The invariant, swept over the whole corpus. Deliberately NOT "the set
    // stays under N items": Barrows returns 27 and The Mimic 23, and both are
    // correct — Barrows' 24 set pieces sit at ~1/2,460 each and the Mimic's 23
    // 3rd age pieces at ~1/2,860. A cap would have called those a bug. What
    // must hold is that nothing commoner than the threshold ever gets in.
    let checked = 0
    for (const file of readdirSync(join(ROOT, 'bosses')).filter((f) => f.endsWith('.json'))) {
      const boss = loadBoss(file.slice(0, -'.json'.length))
      let ev
      try {
        ev = expectedValue(boss, DEFAULT_SIM_CONTEXT, { tables: shared })
      } catch {
        continue // unsupported for analytic EV; nothing is highlighted
      }
      const rarest = rarestItemKeys(boss, ev)
      const own = ownItemKeys(boss)
      for (const item of ev.items) {
        if (!rarest.has(item.itemKey)) continue
        expect(own.has(item.itemKey)).toBe(true)
        expect(1 / item.expectedDrops).toBeGreaterThanOrEqual(RAREST_THRESHOLD)
      }
      checked += 1
    }
    // Guards the guard: a corpus that threw on every source would pass vacuously.
    expect(checked).toBeGreaterThan(40)
  })

  it('is monotone in the threshold', () => {
    const boss = loadBoss('vorkath')
    const ev = expectedValue(boss, DEFAULT_SIM_CONTEXT, { tables: shared })
    const loose = rarestItemKeys(boss, ev, RAREST_THRESHOLD)
    const strict = rarestItemKeys(boss, ev, RAREST_THRESHOLD * 10)
    for (const key of strict) expect(loose.has(key)).toBe(true)
  })
})
