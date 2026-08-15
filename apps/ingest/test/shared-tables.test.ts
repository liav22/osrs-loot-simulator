import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  SharedTableSchema,
  compileBoss,
  expectedValue,
  resolveSimContext,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * `data/tables/*.json` are hand-authored, wiki-verified shared-table records
 * (PROJECT_PLAN.md 5), not generated snapshot output — unlike
 * `data/snapshots/`, they are committed and expected to always be present, so
 * this test does not skip when they're missing.
 */

const TABLE_IDS = ['rare_drop_table', 'gem_drop_table', 'mega_rare_drop_table'] as const

async function loadTable(id: string): Promise<Table> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'tables', `${id}.json`), 'utf8'))
  return SharedTableSchema.parse(raw)
}

async function loadAll(): Promise<Map<string, Table>> {
  const shared = new Map<string, Table>()
  for (const id of TABLE_IDS) shared.set(id, await loadTable(id))
  return shared
}

/** A boss whose only table is unconditional access into the RDT, so its EV IS the RDT's. */
function rdtAccessBoss(): Boss {
  return BossSchema.parse({
    slug: 'test-rdt-access',
    name: 'Test RDT Access',
    wikiPage: 'Test',
    wikiRevId: 1,
    tables: [
      {
        id: 'access',
        mode: 'always',
        entries: [{ node: { kind: 'tableRef', ref: 'rare_drop_table' }, rate: { kind: 'always' } }],
      },
    ],
    status: 'needs_review',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: false, checks: [] },
  })
}

describe('shared tables (data/tables/)', () => {
  it('each record validates against SharedTableSchema and its weights sum to its denominator', async () => {
    for (const id of TABLE_IDS) {
      const table = await loadTable(id)
      expect(table.id).toBe(id)
      expect(table.mode).toBe('weighted')
      const total = table.entries.reduce(
        (sum, entry) => sum + (entry.rate.kind === 'weight' && typeof entry.rate.weight === 'number' ? entry.rate.weight : 0),
        0
      )
      expect(total).toBe(table.denominator)
    }
  })

  it('rare_drop_table references gem_drop_table and mega_rare_drop_table by tableRef', async () => {
    const rdt = await loadTable('rare_drop_table')
    const refs = rdt.entries.filter((e) => e.node.kind === 'tableRef').map((e) => (e.node as { ref: string }).ref)
    expect(refs.sort()).toEqual(['gem_drop_table', 'mega_rare_drop_table'])
  })

  it('gem_drop_table gates its mega_rare_drop_table sub-access on Legends\' Quest', async () => {
    const gem = await loadTable('gem_drop_table')
    const megaRareEntry = gem.entries.find((e) => e.node.kind === 'tableRef')
    expect(megaRareEntry?.conditions).toEqual([{ kind: 'questComplete', quest: "Legends' Quest" }])
  })

  it('compiles the full diamond-shaped dependency graph without a cycle error', async () => {
    const shared = await loadAll()
    const ctx = resolveSimContext(rdtAccessBoss(), {})
    const compiled = compileBoss(rdtAccessBoss(), ctx, { tables: shared })
    expect(compiled.tables).toHaveLength(1)
  })

  it('ring of wealth removes every nothing slot and Legends\' Quest closes the last gap', async () => {
    const shared = await loadAll()
    const boss = rdtAccessBoss()

    const noRow = expectedValue(boss, resolveSimContext(boss, { ringOfWealth: false }), { tables: shared })
    const sumNoRow = noRow.items.reduce((sum, i) => sum + i.expectedDrops, 0)
    expect(sumNoRow).toBeLessThan(0.9) // real nothing chance survives without RoW

    const rowNoQuest = expectedValue(boss, resolveSimContext(boss, { ringOfWealth: true }), { tables: shared })
    const sumRowNoQuest = rowNoQuest.items.reduce((sum, i) => sum + i.expectedDrops, 0)
    // Only the un-modelled "mega-rare-via-gem replaced by a talisman when
    // Legends' Quest is incomplete" case (docs/DECISIONS.md) still leaks —
    // (20/128) * (1/65), about 0.24%.
    expect(sumRowNoQuest).toBeGreaterThan(0.99)
    expect(sumRowNoQuest).toBeLessThan(1)

    const rowAndQuest = expectedValue(
      boss,
      resolveSimContext(boss, { ringOfWealth: true, questsComplete: ["Legends' Quest"] }),
      { tables: shared }
    )
    const sumRowAndQuest = rowAndQuest.items.reduce((sum, i) => sum + i.expectedDrops, 0)
    expect(sumRowAndQuest).toBeCloseTo(1, 9)
  })

  it("matches the wiki's stated mega-rare-drop-table fractions exactly once RoW removes its nothing slot", async () => {
    const shared = await loadAll()
    const boss = rdtAccessBoss()
    const ev = expectedValue(
      boss,
      resolveSimContext(boss, { ringOfWealth: true, questsComplete: ["Legends' Quest"] }),
      { tables: shared }
    )
    const byKey = new Map(ev.items.map((i) => [i.itemKey, i.expectedDrops]))
    // Reached two ways: rare_drop_table -> mega_rare_drop_table (15/128) and
    // rare_drop_table -> gem_drop_table -> mega_rare_drop_table (20/128 * 1/65).
    const pDirect = 15 / 128
    const pViaGem = (20 / 128) * (1 / 65)
    const pMegaRare = pDirect + pViaGem
    expect(byKey.get('rune-spear')).toBeCloseTo(pMegaRare * (8 / 15), 9)
    expect(byKey.get('shield-left-half')).toBeCloseTo(pMegaRare * (4 / 15), 9)
    expect(byKey.get('dragon-spear')).toBeCloseTo(pMegaRare * (3 / 15), 9)
  })
})
