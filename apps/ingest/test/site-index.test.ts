import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSiteIndex, SiteIndexSchema } from '../src/site-index.js'
import { BOSSES_DIR } from '../src/parse/parse-boss.js'
import { TABLES_DIR } from '../src/tables/shared-tables.js'

function bossJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    slug: 'test-boss',
    name: 'Test Boss',
    aliases: ['tb'],
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    variants: ['normal'],
    tables: [
      {
        id: 't',
        mode: 'always',
        rolls: 1,
        withoutReplacement: false,
        entries: [
          {
            node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'A', qty: { kind: 'exact', n: 1 } },
            rate: { kind: 'always' },
          },
        ],
      },
    ],
    contextDefaults: {},
    status: 'verified',
    validation: { ok: true, checks: [] },
    source: 'generated',
    parserVersion: 1,
    ...overrides,
  })
}

describe('buildSiteIndex', () => {
  let dir: string
  let tablesDir: string
  let scratch: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'site-index-test-'))
    tablesDir = await mkdtemp(join(tmpdir(), 'site-index-tables-'))
    scratch = await mkdtemp(join(tmpdir(), 'site-index-scratch-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(tablesDir, { recursive: true, force: true })
    await rm(scratch, { recursive: true, force: true })
  })

  it('summarises every boss file into slug/name/aliases/status', async () => {
    await writeFile(join(dir, 'test-boss.json'), bossJson())
    await writeFile(
      join(dir, 'other-boss.json'),
      bossJson({ slug: 'other-boss', name: 'Other Boss', aliases: [], status: 'needs_review' })
    )

    const index = await buildSiteIndex(dir, tablesDir)
    expect(SiteIndexSchema.safeParse(index).success).toBe(true)
    expect(index.entries).toEqual([
      { slug: 'other-boss', name: 'Other Boss', aliases: [], status: 'needs_review', repeatable: true },
      { slug: 'test-boss', name: 'Test Boss', aliases: ['tb'], status: 'verified', repeatable: true },
    ])
  })

  it('carries a non-repeatable source through as repeatable: false, not omitted', async () => {
    await writeFile(join(dir, 'test-boss.json'), bossJson({ repeatable: false }))
    const index = await buildSiteIndex(dir, tablesDir)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]?.repeatable).toBe(false)
  })

  it('produces an empty index for an empty directory', async () => {
    const index = await buildSiteIndex(dir, tablesDir)
    expect(index.entries).toEqual([])
  })

  it('throws on a file that is not a valid Boss document', async () => {
    await writeFile(join(dir, 'broken.json'), JSON.stringify({ not: 'a boss' }))
    await expect(buildSiteIndex(dir, tablesDir)).rejects.toThrow()
  })

  /**
   * `data/snapshots/` is gitignored, so a checkout without it regenerates the
   * index from boss documents that carry no image at all. `image` is optional,
   * so nothing would reject the result — the portraits would just vanish from
   * the committed file. These two tests pin the merge that prevents that.
   */
  it('carries a committed image forward when no snapshot is available', async () => {
    await writeFile(join(dir, 'test-boss.json'), bossJson())
    // Deliberately outside `dir`: that directory is scanned for `*.json` boss
    // documents, so an index file living in it would be parsed as one.
    const indexPath = join(scratch, 'previous-index.json')
    await writeFile(
      indexPath,
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { slug: 'test-boss', name: 'Test Boss', aliases: ['tb'], status: 'verified', image: 'Test Boss.png' },
        ],
        tables: [],
      })
    )

    // 'Test Boss' has no wikitext snapshot, so the only possible source for
    // this value is the file being regenerated.
    const index = await buildSiteIndex(dir, tablesDir, indexPath)
    expect(index.entries[0]?.image).toBe('Test Boss.png')
  })

  it('omits the image when there is neither a snapshot nor a committed value', async () => {
    await writeFile(join(dir, 'test-boss.json'), bossJson())
    const index = await buildSiteIndex(dir, tablesDir, join(scratch, 'does-not-exist.json'))
    expect(index.entries[0]).not.toHaveProperty('image')
    expect(SiteIndexSchema.safeParse(index).success).toBe(true)
  })

  it('lists every shared-table id from the directory, sorted', async () => {
    await writeFile(join(tablesDir, 'zeta_table.json'), '{}')
    await writeFile(join(tablesDir, 'alpha_table.json'), '{}')
    await writeFile(join(tablesDir, 'notes.txt'), 'ignored')

    const index = await buildSiteIndex(dir, tablesDir)
    expect(index.tables).toEqual(['alpha_table', 'zeta_table'])
  })
})

/**
 * The `tables` manifest is what the browser fetches shared tables by
 * (`apps/web/src/lib/api.ts`), so it is load-bearing in exactly the way a
 * hardcoded list was before it. This is the check that would have caught the
 * hardcoded version: it asserts coverage against the real committed corpus
 * rather than against a fixture, because the bug was that the list and the
 * directory disagreed, and no fixture can disagree with itself.
 *
 * Note what this does NOT assume: it does not require the manifest to equal
 * the set of referenced ids. `data/tables/` may legitimately hold a record
 * nothing references yet. It requires the manifest to COVER them — the
 * direction that breaks production.
 */
describe('the real site index covers every tableRef in the real corpus', () => {
  function refsIn(value: unknown, into: Set<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) refsIn(item, into)
      return
    }
    if (value === null || typeof value !== 'object') return
    const node = value as { kind?: unknown; ref?: unknown }
    if (node.kind === 'tableRef' && typeof node.ref === 'string') into.add(node.ref)
    for (const child of Object.values(value)) refsIn(child, into)
  }

  it('every tableRef reachable from a boss document is in index.tables', async () => {
    const index = await buildSiteIndex()

    const referenced = new Set<string>()
    for (const file of (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))) {
      refsIn(JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8')), referenced)
    }
    // Shared tables reference each other too — rare_drop_table reaches the gem
    // table, which reaches mega-rare. A manifest covering only what bosses name
    // directly would still leave the browser unable to resolve the chain.
    for (const file of (await readdir(TABLES_DIR)).filter((f) => f.endsWith('.json'))) {
      refsIn(JSON.parse(await readFile(join(TABLES_DIR, file), 'utf8')), referenced)
    }

    // Guards the guard: a corpus with no tableRefs at all would pass vacuously.
    expect(referenced.size).toBeGreaterThan(0)

    const missing = [...referenced].filter((ref) => !index.tables.includes(ref)).sort()
    expect(missing).toEqual([])
  })
})
