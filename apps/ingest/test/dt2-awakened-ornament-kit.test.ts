import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  expectedValue,
  SharedTableSchema,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * `docs/OVERRIDES.md` step 3 for `data/overrides/{duke-sucellus,the-leviathan,
 * the-whisperer,vardorvis}.json`: checks the modelled mechanic against the
 * wiki's own stated figure, run against the REAL generated documents so it
 * fails if a future re-parse stops emitting the gate.
 *
 * Every one of the four DT2 bosses' pages carries the same `raritynotes` ref
 * verbatim on their Ancient blood ornament kit (item 28336) row: "Only when
 * defeated in the awakened encounter as the last of the four." The generated
 * documents modelled it as an unconditional `always` drop before this
 * override — this file is the check that it is now 0% on an ordinary kill
 * and 100% on a kill with the `awakened` toggle on, for all four, and that a
 * boss with no such mechanic is untouched.
 */

const DT2_SLUGS = ['duke-sucellus', 'the-leviathan', 'the-whisperer', 'vardorvis'] as const
const ORNAMENT_KIT_ITEM_ID = 28336

async function loadBoss(slug: string): Promise<Boss> {
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'bosses', `${slug}.json`), 'utf8'))
  return BossSchema.parse(raw)
}

/** Each DT2 boss's own generated `<slug>-supplies-bundle` shared table, for its `tableRef`. */
async function bundleTableFor(slug: string): Promise<ReadonlyMap<string, Table>> {
  const id = `${slug}-supplies-bundle`
  const raw = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'tables', `${id}.json`), 'utf8'))
  return new Map([[id, SharedTableSchema.parse(raw)]])
}

describe.each(DT2_SLUGS)("%s's Ancient blood ornament kit", (slug) => {
  it('is gated behind `awakened`, not an unconditional always-drop', async () => {
    const boss = await loadBoss(slug)
    const entry = boss.tables
      .flatMap((table) => table.entries)
      .find((e) => e.node.kind === 'item' && e.node.itemId === ORNAMENT_KIT_ITEM_ID)
    expect(entry).toBeDefined()
    expect(entry?.conditions).toEqual([{ kind: 'awakened', value: true }])
  })

  it('drops 0% of kills with the toggle off, 100% with it on', async () => {
    const boss = await loadBoss(slug)
    const tables = await bundleTableFor(slug)
    const off = expectedValue(boss, { ...DEFAULT_SIM_CONTEXT, awakened: false }, { tables })
    const on = expectedValue(boss, { ...DEFAULT_SIM_CONTEXT, awakened: true }, { tables })

    const kitOff = off.items.find((i) => i.itemId === ORNAMENT_KIT_ITEM_ID)
    const kitOn = on.items.find((i) => i.itemId === ORNAMENT_KIT_ITEM_ID)

    expect(kitOff).toBeUndefined()
    expect(kitOn?.expectedDrops).toBe(1)
    expect(kitOn?.expectedQuantity).toBe(1)
  })

  it('changes nothing else about the document\'s other expected drops', async () => {
    const boss = await loadBoss(slug)
    const tables = await bundleTableFor(slug)
    const off = expectedValue(boss, { ...DEFAULT_SIM_CONTEXT, awakened: false }, { tables })
    const on = expectedValue(boss, { ...DEFAULT_SIM_CONTEXT, awakened: true }, { tables })

    const otherItemsOff = off.items.filter((i) => i.itemId !== ORNAMENT_KIT_ITEM_ID)
    const otherItemsOn = on.items.filter((i) => i.itemId !== ORNAMENT_KIT_ITEM_ID)
    expect(otherItemsOn.length).toBe(otherItemsOff.length)
    for (const item of otherItemsOff) {
      const counterpart = otherItemsOn.find((i) => i.itemId === item.itemId)
      expect(counterpart?.expectedQuantity).toBeCloseTo(item.expectedQuantity, 12)
    }
  })
})

describe('deterministic checks other than the pre-existing duke-sucellus watchlist entry', () => {
  it('the-leviathan, the-whisperer and vardorvis pass every deterministic check (manual_override)', async () => {
    for (const slug of ['the-leviathan', 'the-whisperer', 'vardorvis']) {
      const boss = await loadBoss(slug)
      expect(boss.status, slug).toBe('manual_override')
      const failing = boss.validation.checks
        .filter((c) => !c.ok && c.check !== 'ev_matches')
        .map((c) => c.check)
      expect(failing, `${slug} failing checks`).toEqual([])
    }
  })

  it("duke-sucellus stays needs_review on its pre-existing, unrelated roll-chain gap only", async () => {
    const boss = await loadBoss('duke-sucellus')
    expect(boss.status).toBe('needs_review')
    const failing = boss.validation.checks
      .filter((c) => !c.ok && c.check !== 'ev_matches')
      .map((c) => c.check)
    expect(failing).toEqual(['not_on_watchlist'])
  })
})

describe('a boss with no awakened mechanic is untouched', () => {
  it('vorkath has no `awakened` condition anywhere in its document', async () => {
    const boss = await loadBoss('vorkath')
    const hasAwakened = boss.tables
      .flatMap((table) => table.entries)
      .some((e) => e.conditions?.some((c) => c.kind === 'awakened') ?? false)
    expect(hasAwakened).toBe(false)
  })
})
