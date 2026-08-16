import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BossSchema,
  expectedValue,
  resolveSimContext,
  WeightsExceedDenominatorError,
  type Boss,
  type Node,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { BOSSES_DIR } from '../src/parse/parse-boss.js'
import { snapshotPath, readSnapshot, slugify } from '../src/snapshots/store.js'
import { BucketResponseSchema } from '../src/wiki/schemas.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'

/**
 * What the simulator ACTUALLY drops, per item, against the rate the wiki
 * publishes for that item.
 *
 * Every other check in this repo is structural: `weights_sum` reconciles a
 * table against its denominator, `drops_covered` asks whether an item is
 * reachable at all, `rates_valid` asks whether a rate is well-formed. Not one
 * of them composes the document and asks whether the resulting per-kill
 * probability is the number the wiki states — so a table whose own rows are
 * individually perfect can still be wrong because of what a NEIGHBOURING table
 * does to it.
 *
 * That is not hypothetical, and it is why this file exists. Modelling the
 * transcluded seed/herb/talisman sub-tables as `preroll` suppressed every
 * weighted table after them, putting Arrg's Coal 23.45% under its stated
 * 1/42.7 and Giant sea snake's Adamant dart tip 13.83% under — in shipped
 * data, with every structural check green and `drops_covered` passing, because
 * coverage is by item NAME. Modelling them as `independent` lands both exactly
 * on the published figure. Nothing else in the suite could see the difference.
 */

const SNAPSHOTS_PRESENT = existsSync(snapshotPath('dropsline', 'arrg'))

/**
 * Rounding in the wiki's own published figures (`1/416.7`) plus float
 * composition. Deliberately tight: the defect this exists to catch was 4-23%,
 * and a loose tolerance would have waved it through.
 */
const TOLERANCE = 0.005

/** Items the bucket lists at a single, unambiguous fixed rate, keyed by name. */
async function statedRates(title: string): Promise<Map<string, number> | null> {
  try {
    const snapshot = await readSnapshot('dropsline', slugify(title))
    const rows = BucketResponseSchema.parse(snapshot.body).bucket ?? []
    const byName = new Map<string, number[]>()
    for (const row of rows) {
      const name = row.item_name
      const json = row.drop_json
      if (typeof name !== 'string' || typeof json !== 'string') continue
      const parsed = JSON.parse(json) as { Rarity?: string; Rolls?: number }
      const match = /^~?\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*$/.exec(parsed.Rarity ?? '')
      // `Rolls > 1` means the wiki's figure is per-roll, not per-kill, so the
      // comparison would need the roll count folded in — out of scope here.
      if (match === null || (parsed.Rolls ?? 1) !== 1) continue
      const rate = Number(match[1]!.replace(/,/g, '')) / Number(match[2]!.replace(/,/g, ''))
      if (!Number.isFinite(rate)) continue
      byName.set(name, [...(byName.get(name) ?? []), rate])
    }
    // A name the bucket lists more than once (Nature talisman appears both on
    // the talisman table and via the RDT chain) has no single stated rate.
    return new Map([...byName].filter(([, rates]) => rates.length === 1).map(([n, r]) => [n, r[0]!]))
  } catch {
    return null
  }
}

/** How many times each item name appears as a node in the document itself. */
function occurrences(tables: readonly Table[]): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (node: Node): void => {
    if (node.kind === 'item') counts.set(node.name, (counts.get(node.name) ?? 0) + 1)
    else if (node.kind === 'oneOf') node.entries.forEach((entry) => visit(entry.node))
  }
  for (const table of tables) for (const entry of table.entries) visit(entry.node)
  return counts
}

/** Every item name reachable through a `tableRef`, which contributes extra mass. */
function viaSharedTables(tables: readonly Table[], shared: ReadonlyMap<string, Table>): Set<string> {
  const names = new Set<string>()
  const seen = new Set<string>()
  const visitTable = (table: Table): void => {
    for (const entry of table.entries) visit(entry.node, true)
  }
  const visit = (node: Node, inside: boolean): void => {
    if (node.kind === 'item') {
      if (inside) names.add(node.name)
    } else if (node.kind === 'oneOf') node.entries.forEach((e) => visit(e.node, inside))
    else if (node.kind === 'tableRef') {
      if (seen.has(node.ref)) return
      seen.add(node.ref)
      const target = shared.get(node.ref)
      if (target !== undefined) visitTable(target)
    }
  }
  for (const table of tables) for (const entry of table.entries) visit(entry.node, false)
  return names
}

interface Deviation {
  slug: string
  item: string
  stated: number
  actual: number
  errorPct: number
}

/**
 * Tables sitting downstream of a real pre-roll, whose composed probability is
 * therefore NOT expected to equal the wiki's flat published figure.
 *
 * PROJECT_PLAN.md 4.3: a pre-roll hit short-circuits the main-drop chain, so
 * every later `weighted`/`preroll` table is reached only when the pre-roll
 * misses. The wiki publishes main-table rows as a flat `N/denominator` that
 * does not account for that, which shows up here as a uniform shortfall across
 * a whole table — Brutus' 10/150 pre-roll puts all thirteen of its main-table
 * rows exactly 6.54% low.
 *
 * That is a pre-existing question about what the wiki's figures MEAN, not a
 * defect this test can adjudicate, so those items are excluded rather than
 * silently tolerated by a loose threshold. What remains is the population
 * where the composed probability genuinely must equal the stated rate — which
 * still includes every table that follows a transcluded sub-table, because a
 * sub-table modelled as `independent` suppresses nothing. That is exactly the
 * regression this file exists for.
 */
function excludedTableIndices(tables: readonly Table[]): Set<number> {
  const excluded = new Set<number>()
  let chainBroken = false
  tables.forEach((table, index) => {
    // Mirrors `suppressedByPreroll` in the loot model, which is not exported.
    if (chainBroken && (table.mode === 'weighted' || table.mode === 'preroll')) excluded.add(index)
    // A `preroll` table's OWN entries are a first-hit-wins chain, so every
    // entry after the first is reached only when the ones before it miss:
    // Callisto's Tyrannical ring composes 1.56% under its flat published
    // 1/512 for that reason alone. Whether the wiki's figures are meant to be
    // read that way is the long-running "Uniques heading" question these very
    // sources are already flagged `needs_review` over — this test does not get
    // to settle it by asserting one reading.
    if (table.mode === 'preroll') excluded.add(index)
    if (table.mode === 'preroll' || table.suppressesFollowing === true) chainBroken = true
  })
  return excluded
}

/** Every item name reachable from a node, `oneOf` included. */
function collectNames(node: Table['entries'][number]['node'], into: Set<string>): void {
  if (node.kind === 'item') {
    into.add(node.name)
    return
  }
  if (node.kind === 'oneOf') {
    for (const entry of node.entries) collectNames(entry.node, into)
  }
}

/**
 * Items whose composed per-kill probability is directly comparable to the
 * wiki's stated rate: they appear exactly once in the document, are not also
 * reachable through a shared table, sit in a table no pre-roll shadows, and
 * the bucket lists exactly one rate for them. Everything else is excluded
 * because the COMPARISON would be invalid, never because the number looked
 * inconvenient.
 */
/**
 * Slugs whose document does not COMPILE, so no per-item rate exists to compare.
 *
 * Counted and asserted below rather than skipped quietly — `weights_sum`
 * already reports each of these as a real failure, and a document that cannot
 * compile is not evidence about marginal rates either way. The list is
 * asserted exactly, so a source silently joining it is a test failure, not a
 * shrug (docs/HANDOFF.md landmine #11f: an exclusion list that grows until
 * nothing is left to check is one of the three shapes that produce a vacuous
 * green).
 */
const DOES_NOT_COMPILE: string[] = []

async function deviations(
  slug: string,
  boss: Boss,
  shared: ReadonlyMap<string, Table>
): Promise<Deviation[] | null> {
  const stated = await statedRates(boss.wikiPage)
  if (stated === null) return null

  const counts = occurrences(boss.tables)
  const shadowed = viaSharedTables(boss.tables, shared)
  const suppressed = excludedTableIndices(boss.tables)
  const downstream = new Set<string>()
  boss.tables.forEach((table, index) => {
    if (!suppressed.has(index)) return
    // Descends into `oneOf`. A flat `entry.node.kind === 'item'` loop is the
    // exact shape docs/HANDOFF.md landmine #11 records finding permissive four
    // separate times (`items_known` was the fourth), and it was wrong here too:
    // ToA's seven uniques sit inside a `oneOf` behind a preroll rate, so this
    // loop collected none of them and the suppression exclusion never reached
    // them. They then "deviated" by exactly the unique chance — a correct
    // model failing an incorrect comparison.
    for (const entry of table.entries) collectNames(entry.node, downstream)
  })
  // A document whose weights exceed their denominator throws out of
  // `compileBoss`. That is `weights_sum`'s failure to report, and it used to
  // abort this whole suite on the first such source; record it and move on.
  let result
  try {
    result = expectedValue(boss, resolveSimContext(boss, {}), { tables: shared })
  } catch (error) {
    if (error instanceof WeightsExceedDenominatorError) {
      DOES_NOT_COMPILE.push(slug)
      return null
    }
    throw error
  }

  const found: Deviation[] = []
  for (const item of result.items) {
    const expected = stated.get(item.name)
    if (expected === undefined) continue
    if (counts.get(item.name) !== 1) continue
    if (shadowed.has(item.name)) continue
    if (downstream.has(item.name)) continue
    const errorPct = (item.expectedDrops / expected - 1) * 100
    if (Math.abs(item.expectedDrops / expected - 1) > TOLERANCE) {
      found.push({ slug, item: item.name, stated: expected, actual: item.expectedDrops, errorPct })
    }
  }
  return found
}

let shared: ReadonlyMap<string, Table>
let corpus: { slug: string; boss: Boss }[] = []

beforeAll(async () => {
  if (!SNAPSHOTS_PRESENT) return
  shared = await loadSharedTables()
  const files = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))
  corpus = await Promise.all(
    files.map(async (file) => ({
      slug: file.replace(/\.json$/, ''),
      boss: BossSchema.parse(JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8'))),
    }))
  )
})

describe.skipIf(!SNAPSHOTS_PRESENT)('per-item drop rates, composed', () => {
  /**
   * Documents whose rates are deliberately NOT the bucket's, with the reason.
   * Each is a hand-authored override modelling a mechanic the bucket's flat
   * per-row figure cannot express, and each carries its own wiki-figure test.
   */
  const AUTHORED = new Map([
    ['doom-of-mokhaiotl', 'delve-level scaling; pinned by doom-of-mokhaiotl.test.ts'],
    ['lunar-chest', 'per-set duplicate protection; pinned by lunar-chest.test.ts'],
    ['reward-pool', 'modelled per reward permit, not per encounter; pinned by reward-pool.test.ts'],
    ['zalcano', 'role- and damage-gated; pinned by zalcano.test.ts'],
  ])

  it('every source reproduces the wiki’s stated per-item rate', async () => {
    const offenders: Deviation[] = []
    for (const { slug, boss } of corpus) {
      if (AUTHORED.has(slug)) continue
      const found = await deviations(slug, boss, shared)
      if (found !== null) offenders.push(...found)
    }

    // Reported with the numbers, because the failure mode is quantitative: a
    // bare "expected [] to equal [...]" would say nothing about how far off.
    const report = offenders
      .sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct))
      .slice(0, 15)
      .map(
        (d) =>
          `${d.slug} / ${d.item}: stated ${d.stated.toFixed(6)}, composed ${d.actual.toFixed(6)} (${d.errorPct.toFixed(2)}%)`
      )
    expect(report, `${offenders.length} item(s) deviate`).toEqual([])

    // Named exactly, so this cannot quietly become the place sources go to
    // avoid the comparison. Each is a real `weights_sum` failure reported as
    // such on its own document.
    // All eight are tier D sources whose main table genuinely overflows its
    // denominator — the very thing that put them in tier D at triage. The
    // overflow is real data, not a classification artifact.
    expect([...new Set(DOES_NOT_COMPILE)].sort()).toEqual([
      'chaos-fanatic',
      'commander-zilyana',
      'grotesque-guardians',
      'k-ril-tsutsaroth',
      'mad-angel',
      'maggot-king',
      'phosani-s-nightmare',
      'yama',
    ])
  })

  /**
   * The specific regression, named. `preroll` on a transcluded sub-table
   * suppresses every weighted table after it; these two were the worst of it,
   * and both are exact under `independent`.
   */
  it('is not distorted by a transcluded sub-table suppressing its neighbours', async () => {
    for (const [slug, item] of [
      ['arrg', 'Coal'],
      ['arrg', 'Raw mackerel'],
      ['giant-sea-snake', 'Adamant dart tip'],
      ['giant-sea-snake', 'Fishing bait'],
      ['dagannoth-rex', 'Grimy ranarr weed'],
    ] as const) {
      const entry = corpus.find((c) => c.slug === slug)
      if (entry === undefined) continue
      const found = await deviations(slug, entry.boss, shared)
      expect(found?.filter((d) => d.item === item), `${slug} / ${item}`).toEqual([])
    }
  })

  it('has enough comparable items to be meaningful, not vacuously green', async () => {
    // The exclusions above are principled but they are also how this test
    // could quietly stop testing anything. This pins that it still covers a
    // substantial share of the corpus.
    let comparable = 0
    for (const { boss } of corpus) {
      const stated = await statedRates(boss.wikiPage)
      if (stated === null) continue
      const counts = occurrences(boss.tables)
      const shadowed = viaSharedTables(boss.tables, shared)
      const suppressed = excludedTableIndices(boss.tables)
      const downstream = new Set<string>()
      boss.tables.forEach((table, index) => {
        if (!suppressed.has(index)) return
        for (const e of table.entries) if (e.node.kind === 'item') downstream.add(e.node.name)
      })
      for (const [name] of stated) {
        if (counts.get(name) === 1 && !shadowed.has(name) && !downstream.has(name)) comparable++
      }
    }
    expect(comparable).toBeGreaterThan(300)
  })
})
