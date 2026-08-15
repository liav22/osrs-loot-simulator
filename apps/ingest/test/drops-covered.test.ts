import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BossSchema, type Boss, type BossInput, type Table } from '@osrs-loot-simulator/loot-model'
import {
  bucketItemNames,
  checkDropsCovered,
  checkDropsCoveredAgainst,
  reachableItemNames,
} from '../src/validate/drops-covered.js'
import { BOSSES_DIR } from '../src/parse/parse-boss.js'
import { snapshotPath } from '../src/snapshots/store.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'

/**
 * `data/snapshots/` is gitignored and regenerable, so it is absent on every CI
 * checkout. The suites below compare committed documents against the dropsline
 * bucket that lives there; with no bucket, `checkDropsCovered` correctly
 * returns a vacuous pass, which would make "agrees with the committed document"
 * fail for the 26 sources recorded as failing.
 *
 * Guarded the same way `brutus-snapshot.test.ts` is — and for the same reason
 * that file had to be fixed: a snapshot-dependent assertion that does not
 * declare its dependency is a red CI run waiting to happen.
 */
const SNAPSHOTS_PRESENT = existsSync(snapshotPath('dropsline', 'corporeal-beast'))

function boss(tables: BossInput['tables']): Boss {
  return BossSchema.parse({
    slug: 'covered-test',
    name: 'Covered Test',
    wikiPage: 'Covered Test',
    wikiRevId: 1,
    tables,
    status: 'needs_review',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: false, checks: [] },
  })
}

function item(name: string, itemId: number) {
  return {
    node: { kind: 'item' as const, itemId, itemKey: name.toLowerCase(), name, qty: { kind: 'exact' as const, n: 1 } },
    rate: { kind: 'always' as const },
  }
}

const NO_TABLES: ReadonlyMap<string, Table> = new Map()

describe('reachableItemNames', () => {
  it('follows tableRef into shared records', () => {
    // A boss that reaches the rare drop table really does drop everything in
    // it, so those names must count as covered — otherwise every RDT source
    // fails for items it genuinely has.
    const shared: Map<string, Table> = new Map([
      [
        'shared',
        {
          id: 'shared',
          mode: 'weighted',
          rolls: 1,
          withoutReplacement: false,
          denominator: 2,
          entries: [{ ...item('Inside Shared', 2), rate: { kind: 'weight', weight: 1 } }],
        } as Table,
      ],
    ])
    const names = reachableItemNames(
      [
        {
          id: 'main',
          mode: 'always',
          rolls: 1,
          withoutReplacement: false,
          entries: [item('Own', 1), { node: { kind: 'tableRef', ref: 'shared' }, rate: { kind: 'always' } }],
        } as Table,
      ],
      shared
    )
    expect([...names].sort()).toEqual(['Inside Shared', 'Own'])
  })

  it('descends oneOf', () => {
    const names = reachableItemNames(
      [
        {
          id: 'main',
          mode: 'weighted',
          rolls: 1,
          withoutReplacement: false,
          denominator: 1,
          entries: [
            {
              node: {
                kind: 'oneOf',
                entries: [
                  { ...item('Nested A', 1), rate: { kind: 'weight', weight: 1 } },
                  { ...item('Nested B', 2), rate: { kind: 'weight', weight: 1 } },
                ],
              },
              rate: { kind: 'weight', weight: 1 },
            },
          ],
        } as Table,
      ],
      NO_TABLES
    )
    expect([...names].sort()).toEqual(['Nested A', 'Nested B'])
  })

  it('terminates on a self-referential shared table', () => {
    const shared: Map<string, Table> = new Map([
      [
        'loop',
        {
          id: 'loop',
          mode: 'always',
          rolls: 1,
          withoutReplacement: false,
          entries: [
            item('In Loop', 9),
            { node: { kind: 'tableRef', ref: 'loop' }, rate: { kind: 'always' } },
          ],
        } as Table,
      ],
    ])
    const names = reachableItemNames(
      [
        {
          id: 'main',
          mode: 'always',
          rolls: 1,
          withoutReplacement: false,
          entries: [{ node: { kind: 'tableRef', ref: 'loop' }, rate: { kind: 'always' } }],
        } as Table,
      ],
      shared
    )
    expect([...names]).toEqual(['In Loop'])
  })
})

describe('checkDropsCoveredAgainst', () => {
  const document = boss([
    { id: 'main', mode: 'always', entries: [item('Present', 1)] },
  ] as BossInput['tables'])

  it('passes when every wiki row is reachable', () => {
    const result = checkDropsCoveredAgainst(['Present'], document.tables, NO_TABLES)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('fails, and names what is missing', () => {
    const result = checkDropsCoveredAgainst(['Present', 'Absent'], document.tables, NO_TABLES)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Absent'])
    expect(result.detail).toContain('1 of 2')
  })

  it('does NOT require the reverse direction', () => {
    // A document legitimately carries items the bucket never listed — every
    // override-authored source builds tables from prose the bucket never saw.
    // Asserting set equality would fail Lunar Chest and Reward pool outright.
    const result = checkDropsCoveredAgainst([], document.tables, NO_TABLES)
    expect(result.ok).toBe(true)
  })

  it('ignores the "Nothing" pseudo-row', () => {
    // Not an item: the parser models it as the weighted table's implicit
    // remainder, so no document will ever have a node named that.
    expect(checkDropsCoveredAgainst(['Present', 'Nothing'], document.tables, NO_TABLES).ok).toBe(true)
  })

  it('accepts a page-anchor name against its parenthesised form', () => {
    // The bucket records Amoxliatl's as `Pendant of ates#Inert`; the document,
    // the item index and the wiki's display name all use `(inert)`.
    const withPendant = boss([
      { id: 'main', mode: 'always', entries: [item('Pendant of ates (inert)', 5)] },
    ] as BossInput['tables'])
    expect(
      checkDropsCoveredAgainst(['Pendant of ates#Inert'], withPendant.tables, NO_TABLES).ok
    ).toBe(true)
    // And it is a translation, not fuzzy matching — an unrelated anchor still fails.
    expect(
      checkDropsCoveredAgainst(['Pendant of something#Inert'], withPendant.tables, NO_TABLES).ok
    ).toBe(false)
  })

  it('passes when there is no oracle, and says so out loud', () => {
    // The scope this check has. `refs_resolve` once reported "resolved against
    // 0 shared table(s)" as a clean pass and nobody noticed for months; the
    // lesson is that a vacuous pass must announce itself.
    const result = checkDropsCoveredAgainst(null, document.tables, NO_TABLES, 'No Snapshot')
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('coverage not checked')
  })
})

/**
 * Against the real corpus. The point of this check is a specific, measured
 * failure, and a fixture cannot demonstrate that the pipeline really lost
 * those rows.
 */
describe.skipIf(!SNAPSHOTS_PRESENT)('the real corpus', () => {
  it("catches Corporeal Beast's transcluded sigils", async () => {
    const shared = await loadSharedTables()
    const corp = BossSchema.parse(
      JSON.parse(await readFile(join(BOSSES_DIR, 'corporeal-beast.json'), 'utf8'))
    )
    const result = await checkDropsCovered('Corporeal Beast', corp.tables, shared)

    // `===Sigils=== {{Uniques/Corporeal Beast}}` — a transclusion, so
    // `extractDropLines` finds no {{DropsLine}} rows and the section vanishes.
    // Corp's 512 table sums flush without them (they are a separate 1/585
    // roll), which is why `weights_sum` never could have noticed.
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['Arcane sigil', 'Elysian sigil', 'Spectral sigil'])
  })

  it('agrees with every committed document, so the corpus is self-consistent', async () => {
    const shared = await loadSharedTables()
    const files = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(50)

    for (const file of files) {
      const document = BossSchema.parse(JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8')))
      const recorded = document.validation.checks.find((c) => c.check === 'drops_covered')
      // Every committed document must carry the check — a file written before
      // it existed is a stale file, which is landmine #1's failure mode.
      expect(recorded, `${file} has no drops_covered check`).toBeDefined()

      const fresh = await checkDropsCovered(document.wikiPage, document.tables, shared)
      expect(fresh.ok, `${file}: recorded ${recorded?.ok}, fresh ${fresh.ok}`).toBe(recorded?.ok)
    }
  })

  it('a verified source has no missing drops, by construction', async () => {
    // The gate. `verified` has meant "derived from the wiki unaided" all
    // project, and this is what now makes that claim checkable.
    const shared = await loadSharedTables()
    const files = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))
    let verified = 0

    for (const file of files) {
      const document = BossSchema.parse(JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8')))
      if (document.status !== 'verified') continue
      verified += 1
      const result = await checkDropsCovered(document.wikiPage, document.tables, shared)
      expect(result.missing, `${file} is verified but missing drops`).toEqual([])
    }
    expect(verified).toBeGreaterThan(0)
  })

  it('has an oracle for every source, so nothing passes vacuously', async () => {
    // The scope hole this check could have: a source with no dropsline
    // snapshot passes without being looked at. Pinning that the corpus has an
    // oracle everywhere is what stops that being invisible.
    const files = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))
    const without: string[] = []
    for (const file of files) {
      const document = BossSchema.parse(JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8')))
      if ((await bucketItemNames(document.wikiPage)) === null) without.push(document.slug)
    }
    expect(without).toEqual([])
  })
})
