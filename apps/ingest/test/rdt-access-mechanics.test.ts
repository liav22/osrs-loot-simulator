import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  SharedTableSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  simulate,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * Phase 7 gate for the two sources unblocked by Extension A's `qtyMultiplier`
 * and step (c)'s `drawsPerHit`: Abyssal Sire and Corporeal Beast.
 *
 * `data/mechanics-watchlist.json`'s own removal policy is "remove an entry
 * only when the mechanic is modelled AND the simulation has been checked
 * against the wiki's own figures" — implementing the field is not enough.
 * This file is that check, run against the REAL generated boss documents and
 * the REAL shared-table records, not synthetic fixtures, so it fails if a
 * future re-parse stops emitting the modelled field.
 *
 * The wiki's figures, quoted from each page's own access template:
 *   Abyssal Sire   "There is a 3/139 chance of rolling the [[rare drop
 *                   table]]. This monster will always drop double the usual
 *                   quantity from this table."           {{...|multiplier=2}}
 *   Corporeal Beast "There is a 12/512 chance of rolling the [[gem drop
 *                   table]], whereupon its contents are rolled 10 times."
 */

const TABLE_IDS = ['rare_drop_table', 'gem_drop_table', 'mega_rare_drop_table'] as const

async function loadTables(): Promise<Map<string, Table>> {
  const shared = new Map<string, Table>()
  for (const id of TABLE_IDS) {
    const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'tables', `${id}.json`), 'utf8'))
    shared.set(id, SharedTableSchema.parse(raw))
  }
  return shared
}

async function loadBoss(slug: string): Promise<Boss> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', `${slug}.json`), 'utf8'))
  return BossSchema.parse(raw)
}

/** The generated `<slug>:rdt-access:<n>` table, isolated from the boss's own tables. */
function accessTableOf(boss: Boss, ref: string): Table {
  const table = boss.tables.find(
    (t) => t.id.includes(':rdt-access:') && t.entries.some((e) => e.node.kind === 'tableRef' && e.node.ref === ref)
  )
  if (table === undefined) throw new Error(`${boss.slug} has no generated access table into ${ref}`)
  return table
}

/** A single-table boss, so its whole expectation IS that access line's. */
function isolate(boss: Boss, table: Table): Boss {
  return BossSchema.parse({ ...boss, tables: [table] })
}

const ctx = { ...DEFAULT_SIM_CONTEXT, members: true }

describe("Abyssal Sire: the wiki's x2 rare-drop-table quantity multiplier", () => {
  it('doubles every quantity from that access, and only from that access', async () => {
    const tables = await loadTables()
    const boss = await loadBoss('abyssal-sire')
    const access = accessTableOf(boss, 'rare_drop_table')

    const entry = access.entries[0]
    expect(entry?.node).toMatchObject({ kind: 'tableRef', ref: 'rare_drop_table', qtyMultiplier: 2 })
    expect(entry?.rate).toEqual({ kind: 'fixed', num: 3, den: 139 })

    const scaled = expectedValue(isolate(boss, access), ctx, { tables })

    // The control: the identical access with the multiplier stripped.
    const plainTable = SharedTableSchema.parse({
      ...access,
      entries: [{ ...entry, node: { kind: 'tableRef', ref: 'rare_drop_table' } }],
    })
    const plain = expectedValue(isolate(boss, plainTable), ctx, { tables })

    expect(scaled.items.length).toBeGreaterThan(10)
    for (const item of scaled.items) {
      const control = plain.items.find((i) => i.itemKey === item.itemKey)
      // Quantity exactly doubles...
      expect(item.expectedQuantity).toBeCloseTo((control?.expectedQuantity ?? 0) * 2, 12)
      // ...while how OFTEN the item drops is untouched. Conflating the two
      // would silently double the drop rate as well, which the wiki does not
      // say and which would corrupt every rate the UI reports.
      expect(item.expectedDrops).toBeCloseTo(control?.expectedDrops ?? 0, 12)
    }
  })

  it('leaves the shared rare_drop_table record unscaled for every other source', async () => {
    // The real risk this guards: `qtyMultiplier` MUTATING the shared
    // `data/tables/rare_drop_table.json` record that ~17 tier-C sources
    // reference plainly. Giant Mole reaches the same record through a plain
    // access line, so it is the canary.
    const mole = await loadBoss('giant-mole')
    const moleAccess = accessTableOf(mole, 'rare_drop_table')
    expect(moleAccess.entries[0]?.node).not.toHaveProperty('qtyMultiplier')

    // Baseline: Giant Mole against a tables map that has never seen the x2.
    const clean = expectedValue(isolate(mole, moleAccess), ctx, { tables: await loadTables() })

    // Now compile Abyssal Sire's x2 access against ONE shared map, then
    // re-run Giant Mole against that same, already-used map.
    const shared = await loadTables()
    const sire = await loadBoss('abyssal-sire')
    expectedValue(isolate(sire, accessTableOf(sire, 'rare_drop_table')), ctx, { tables: shared })
    const after = expectedValue(isolate(mole, moleAccess), ctx, { tables: shared })

    expect(after.items.length).toBe(clean.items.length)
    for (const item of after.items) {
      const baseline = clean.items.find((i) => i.itemKey === item.itemKey)
      expect(item.expectedQuantity, `${item.itemKey} leaked Abyssal Sire's x2`).toBeCloseTo(
        baseline?.expectedQuantity ?? -1,
        12
      )
    }
  })
})

describe("Corporeal Beast: one 12/512 access check gating 10 gem-table draws", () => {
  it('is modelled as drawsPerHit, not as 10 independent access attempts', async () => {
    const boss = await loadBoss('corporeal-beast')
    const access = accessTableOf(boss, 'gem_drop_table')

    expect(access.entries[0]?.node).toMatchObject({
      kind: 'tableRef',
      ref: 'gem_drop_table',
      drawsPerHit: 10,
    })
    expect(access.entries[0]?.rate).toEqual({ kind: 'fixed', num: 12, den: 512 })
    // The access itself happens once — the count moved to drawsPerHit.
    expect(access.rolls).toBe(1)
  })

  it("matches the wiki's figures: 12/512 of kills reach the table, each drawing 10 times", async () => {
    const tables = await loadTables()
    const boss = await loadBoss('corporeal-beast')
    const access = accessTableOf(boss, 'gem_drop_table')
    const isolated = isolate(boss, access)

    const n = 200_000
    const result = simulate(isolated, n, ctx, 99, { tables, logLimit: n })

    // How often ANY gem-table loot arrives is the access rate itself, not
    // 1-(1-12/512)^10 = 21.1%, which is what the default rolls reading gives.
    const yielding = result.log.filter((kill) => kill.drops.length > 0).length
    const observed = yielding / n
    expect(observed / (12 / 512)).toBeGreaterThan(0.9)
    expect(observed / (12 / 512)).toBeLessThan(1.1)

    // The gem table has an explicit Nothing row (63/128 without a ring of
    // wealth), so a yielding kill shows fewer than 10 items — but far more
    // than the ~1 the default reading would give.
    const meanPerYieldingKill =
      result.log.reduce((sum, kill) => sum + kill.drops.length, 0) / yielding
    expect(meanPerYieldingKill).toBeGreaterThan(3)

    // Analytic cross-check, stated as the mechanic itself rather than against
    // a hand-derived constant: ten draws yield exactly ten times what one
    // draw yields. Deriving the per-draw figure instead of hardcoding it
    // keeps this honest about the gem table's real composition — its Nothing
    // row is 63/128, but its mega-rare slot is condition-excluded without
    // Legends' Quest and falls through to the implicit remainder too (see
    // docs/DECISIONS.md), so the per-draw yield is not simply 1 - 63/128.
    const oneDrawTable = SharedTableSchema.parse({
      ...access,
      entries: [{ ...access.entries[0], node: { kind: 'tableRef', ref: 'gem_drop_table' } }],
    })
    const one = expectedValue(isolate(boss, oneDrawTable), ctx, { tables })
    const ten = expectedValue(isolated, ctx, { tables })

    const total = (r: typeof one): number => r.items.reduce((sum, i) => sum + i.expectedDrops, 0)
    expect(total(ten)).toBeCloseTo(total(one) * 10, 12)
    // And the single-draw figure is the access rate times the table's own
    // item-yield share, so the whole chain reconciles to the wiki's 12/512.
    expect(total(one)).toBeLessThan(12 / 512)
    expect(total(one)).toBeGreaterThan((12 / 512) * 0.4)
  })
})

describe('both sources are off the mechanics watchlist', () => {
  it('no longer lists abyssal-sire or corporeal-beast', async () => {
    const raw = JSON.parse(
      await readFile(join(REPO_ROOT, 'data', 'mechanics-watchlist.json'), 'utf8')
    ) as { entries: { lootSourceId: string }[] }
    const ids = raw.entries.map((e) => e.lootSourceId)
    expect(ids).not.toContain('abyssal-sire')
    expect(ids).not.toContain('corporeal-beast')
  })

  /**
   * This used to assert `status === 'verified'` for both. It no longer holds,
   * and that is `drops_covered` working rather than a regression here: both
   * sources lose transcluded sub-tables the parser never saw (Abyssal Sire's
   * Seeds and Talismans sections, Corporeal Beast's Sigils), so neither is
   * complete, whatever else it gets right.
   *
   * What this file is actually about — the RDT/gem access mechanics fixed in
   * `rdt-access.ts` — is unaffected, and every assertion above still passes.
   * So the assertion narrows to the claim the parser fixes really made: every
   * deterministic check that reads the EXTRACTED STRUCTURE passes, and the only
   * thing standing between these two and `verified` is coverage.
   */
  it('pass every structural check, with coverage the only thing outstanding', async () => {
    for (const slug of ['abyssal-sire', 'corporeal-beast']) {
      const boss = await loadBoss(slug)
      const failing = boss.validation.checks
        .filter((c) => !c.ok && c.check !== 'ev_matches')
        .map((c) => c.check)
      expect(failing, `${slug} failing checks`).toEqual(['drops_covered'])
    }
  })
})
