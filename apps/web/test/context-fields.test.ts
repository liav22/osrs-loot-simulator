import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { BossSchema, SharedTableSchema, type Boss, type BossInput, type Table } from '@osrs-loot-simulator/loot-model'
import { contextSurfaceOf } from '../src/lib/context-fields'

/**
 * The acceptance criterion for wiring `SimContext` into the UI: the two
 * sources that shipped with an unreachable control must now expose one.
 *
 * Read against the REAL generated documents rather than fixtures — a control
 * derived from a boss document is only correct if it is correct for the
 * document actually on disk, and this is what fails if a future re-parse or
 * override edit drops the condition the control is derived from.
 */
const ROOT = join(__dirname, '..', '..', '..', 'data')

function loadBoss(slug: string): Boss {
  return BossSchema.parse(JSON.parse(readFileSync(join(ROOT, 'bosses', `${slug}.json`), 'utf8')))
}

/** The same `data/tables/` map the app loads alongside a boss. */
function loadSharedTables(): Map<string, Table> {
  const dir = join(ROOT, 'tables')
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const table = SharedTableSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')))
        return [table.id, table] as const
      })
  )
}

const shared = loadSharedTables()

describe('contextSurfaceOf: the controls a boss actually needs', () => {
  it('exposes delveLevel for Doom of Mokhaiotl', () => {
    // "Doom of Mokhaiotl is meaningless without a delveLevel control."
    expect(contextSurfaceOf(loadBoss('doom-of-mokhaiotl')).fields.has('delveLevel')).toBe(true)
  })

  it('exposes moonsKilled for Lunar Chest', () => {
    expect(contextSurfaceOf(loadBoss('lunar-chest')).fields.has('moonsKilled')).toBe(true)
  })

  it('exposes Lunar Chest’s ownership-gated pieces', () => {
    // Per-set duplicate protection is an `ownershipGate`, so the run needs a
    // way to say which pieces are already owned.
    const surface = contextSurfaceOf(loadBoss('lunar-chest'), shared)
    expect(surface.fields.has('ownedCounts')).toBe(true)
    expect(surface.ownershipItemKeys.length).toBeGreaterThan(0)
  })

  it('gives Lunar Chest’s ownership items a real display name, not the raw slug', () => {
    // The UI used to label these controls with `itemKey` directly
    // ("blood-moon-helm"). `name` comes off the same item node the gate
    // lives on, so it should read like an item ("Blood moon helm").
    const surface = contextSurfaceOf(loadBoss('lunar-chest'), shared)
    const helm = surface.ownershipItems.find((item) => item.itemKey === 'blood-moon-helm')
    expect(helm?.name).toBe('Blood moon helm')
  })

  it('marks every current ownership gate as maxN 1 — own it or not', () => {
    // The whole point of `maxN`: every gate in the corpus today is a
    // threshold of 1, which is what lets the UI render a checkbox instead of
    // a number field. If this ever finds an item with maxN > 1, that's real
    // — a source needs a numeric control — not a test to loosen.
    for (const slug of ['lunar-chest', 'chest-tombs-of-amascut', 'ancient-chest']) {
      const surface = contextSurfaceOf(loadBoss(slug), shared)
      for (const item of surface.ownershipItems) {
        expect(item.maxN, `${slug}: ${item.itemKey}`).toBe(1)
      }
    }
  })

  it('exposes both of Zalcano’s damage inputs, and never the derived total', () => {
    const surface = contextSurfaceOf(loadBoss('zalcano'))
    // `totalDamage` is gated on directly by the document, but a control for it
    // would do nothing — `withDerivedContext` recomputes it. The user gets the
    // two inputs instead.
    expect(surface.fields.has('hitpointsDamage')).toBe(true)
    expect(surface.fields.has('shieldDamage')).toBe(true)
    expect(surface.fields.has('totalDamage')).toBe(false)
  })

  it('finds isMVP, which appears in no condition anywhere in the document', () => {
    // This is the case a condition-only scan cannot see: `isMVP` is read only
    // inside `zalcano_mvp_share` / `zalcano_mvp_only`. If this regresses, the
    // MVP toggle silently disappears and the +10% becomes unreachable.
    const boss = loadBoss('zalcano')
    const mentionsIsMvpInAnyCondition = boss.tables.some((table) =>
      table.entries.some((entry) =>
        (entry.conditions ?? []).some((c) => JSON.stringify(c).includes('isMVP'))
      )
    )
    expect(mentionsIsMvpInAnyCondition).toBe(false)
    expect(contextSurfaceOf(boss).fields.has('isMVP')).toBe(true)
  })

  it('does not offer unrelated controls on an ordinary boss', () => {
    // Brutus reads none of the Extension A fields; showing them all would
    // bury the ones that matter behind a dozen that do nothing.
    const surface = contextSurfaceOf(loadBoss('brutus'))
    expect(surface.fields.has('delveLevel')).toBe(false)
    expect(surface.fields.has('moonsKilled')).toBe(false)
    expect(surface.fields.has('isMVP')).toBe(false)
    expect(surface.fields.has('members')).toBe(true)
  })
})

/**
 * `maxN` is what decides whether `SimContextControls` renders a chip or a
 * number field for a given item — no real source needs anything but `n: 1`
 * today, so this exercises the reconciliation logic directly with a
 * synthetic fixture rather than waiting for a real source to need it.
 */
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

function itemEntry(itemKey: string, name: string, gateN: number, when: 'below' | 'atLeast' = 'below') {
  return {
    node: {
      kind: 'item' as const,
      itemId: 1,
      itemKey,
      name,
      qty: { kind: 'exact' as const, n: 1 },
    },
    rate: { kind: 'weight' as const, weight: 1 },
    ownershipGate: { itemKey, n: gateN, when },
  }
}

describe('ownership item reconciliation (maxN)', () => {
  it('takes the higher n when the same item is gated more than once', () => {
    // Not a real shape yet, but the schema allows it and the UI has to pick
    // ONE control for one item key — the higher threshold is the one that
    // actually needs the extra resolution.
    const boss = makeBoss([
      {
        id: 't1',
        mode: 'weighted',
        denominator: 1,
        entries: [itemEntry('rare-thing', 'Rare thing', 1, 'below')],
      },
      {
        id: 't2',
        mode: 'weighted',
        denominator: 1,
        entries: [itemEntry('rare-thing', 'Rare thing', 3, 'atLeast')],
      },
    ])
    const surface = contextSurfaceOf(boss)
    expect(surface.ownershipItems).toEqual([{ itemKey: 'rare-thing', name: 'Rare thing', maxN: 3 }])
  })

  it('a single n:1 gate reports maxN 1, the boolean case', () => {
    const boss = makeBoss([
      { id: 't1', mode: 'weighted', denominator: 1, entries: [itemEntry('common-thing', 'Common thing', 1)] },
    ])
    expect(contextSurfaceOf(boss).ownershipItems).toEqual([
      { itemKey: 'common-thing', name: 'Common thing', maxN: 1 },
    ])
  })
})
